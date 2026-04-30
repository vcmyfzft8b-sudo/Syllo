import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { PartMediaResolutionLevel, type ThinkingConfig } from "@google/genai";
import JSZip from "jszip";
import mammoth from "mammoth";
import { z } from "zod";

import { toUserFacingAiErrorMessage } from "@/lib/ai/errors";
import {
  generateStructuredObjectWithGeminiFile,
  generateTextWithGeminiFile,
} from "@/lib/ai/gemini";
import {
  isDocxDocument,
  isHtmlDocument,
  isPdfDocument,
  isPlainTextDocument,
  isPptxDocument,
  isRtfDocument,
} from "@/lib/document-files";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import {
  NoReadableScanTextError,
  type ScanOcrAttemptDiagnostics,
} from "@/lib/scan-ocr-errors";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  buildSyntheticTranscriptFromTextSource,
  estimateTextSourceDurationSeconds,
  type StructuredSourceBlock,
} from "@/lib/text-source-processing";
import { createEmbeddings as createAiEmbeddings } from "@/lib/ai/embeddings";
import {
  isUnsupportedVideoContentType,
  UNSUPPORTED_VIDEO_LINK_MESSAGE,
} from "@/lib/link-source-validation";
import { serializeVector } from "@/lib/utils";

const pdfExtractionSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(120),
});

const pptxVisualExtractionSchema = z.object({
  title: z.string().min(1),
  slides: z.array(
    z.object({
      slideNumber: z.number().int().positive(),
      text: z.string().min(20),
    }),
  ),
});

const MAX_LINK_FETCH_REDIRECTS = 3;
const MAX_LINK_FETCH_BYTES = 1_000_000;
const MAX_LINK_READABLE_TEXT_CHARS = 45_000;
const LINK_FETCH_TIMEOUT_MS = 10_000;
const TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE = 25;
const OCR_PRIMARY_MAX_OUTPUT_TOKENS = 3500;
const OCR_RESCUE_MAX_OUTPUT_TOKENS = 6000;
const PPTX_VISUAL_EXTRACTION_MAX_OUTPUT_TOKENS = 9000;
const OCR_MIN_ACCEPTED_TEXT_CHARS = 120;
const OCR_THINKING_CONFIG: ThinkingConfig = {
  includeThoughts: false,
  thinkingBudget: 0,
};
const OCR_FAILURE_PATTERNS = [
  /\b(can(?:not|'t)\s+(?:read|extract|see)|unable\s+to\s+(?:read|extract|see))\b/i,
  /\b(no|without)\s+(?:readable\s+)?text\b/i,
  /\bimage\s+(?:is\s+)?(?:blank|too\s+blurry|illegible)\b/i,
  /\bnot\s+enough\s+readable\s+text\b/i,
  /\bni\s+(?:berljivega\s+)?besedila\b/i,
  /\bne\s+morem\s+(?:prebrati|razbrati)\b/i,
];

type TranscriptSegmentInsertRow = {
  lecture_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_label: string | null;
  text: string;
  embedding: string | null;
};

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim().slice(0, 240);
  }

  return "Unknown OCR error.";
}

export type ImageOcrContext = {
  userId?: string | null;
  lectureId?: string | null;
  imageIndex?: number | null;
};

let pdfJsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null =
  null;

async function getPdfJs() {
  if (!pdfJsPromise) {
    const pdfGlobal = globalThis as {
      self?: unknown;
    };

    pdfGlobal.self ??= globalThis;
    pdfJsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  return pdfJsPromise;
}

function isPdfTextItem(
  item: unknown,
): item is {
  str: string;
  hasEOL?: boolean;
} {
  return typeof item === "object" && item !== null && "str" in item;
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeOcrPlainText(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  const textMatch = normalized.match(/(?:^|\n)TEXT:\s*\n([\s\S]*)$/i);

  return normalizeWhitespace(textMatch?.[1] ?? normalized.replace(/^TITLE:\s*.+$/im, ""));
}

function hasFailurePhrase(text: string) {
  return OCR_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAcceptableImageOcrText(text: string) {
  const normalized = normalizeWhitespace(text);

  if (normalized.length < OCR_MIN_ACCEPTED_TEXT_CHARS || hasFailurePhrase(normalized)) {
    return false;
  }

  const compact = normalized.replace(/\s/g, "");

  if (!compact) {
    return false;
  }

  const readableCharacters = Array.from(compact).filter((character) =>
    /[\p{L}\p{N}=+\-*/^.,;:()[\]{}<>%$#@]/u.test(character),
  ).length;

  return readableCharacters / compact.length >= 0.45;
}

function deriveImageTitle(file: File, text: string) {
  const filenameTitle = file.name.replace(/\.[^.]+$/i, "").trim();
  const firstHeading = normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.replace(/^[-*#\d.)\s]+/, "").trim())
    .find(
      (line) =>
        line.length >= 4 &&
        line.length <= 80 &&
        /\p{L}/u.test(line) &&
        !hasFailurePhrase(line),
    );

  return firstHeading || filenameTitle || "Image";
}

function buildImageOcrUsageContext(params: {
  context?: ImageOcrContext;
  stage: string;
  file: File;
}) {
  return {
    stage: params.stage,
    userId: params.context?.userId ?? null,
    lectureId: params.context?.lectureId ?? null,
    metadata: {
      imageIndex: params.context?.imageIndex ?? null,
      fileMimeType: params.file.type || "application/octet-stream",
      fileSize: params.file.size,
    },
  };
}

async function insertTranscriptSegmentsInBatches(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  transcriptRows: TranscriptSegmentInsertRow[],
) {
  for (
    let start = 0;
    start < transcriptRows.length;
    start += TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE
  ) {
    const batch = transcriptRows.slice(start, start + TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE);
    const { error } = await supabase.from("transcript_segments").insert(batch as never);

    if (error) {
      throw error;
    }
  }
}

function rtfToText(rtf: string) {
  return normalizeWhitespace(
    rtf
      .replace(/\\'[0-9a-fA-F]{2}/g, " ")
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\tab/g, " ")
      .replace(/\\[a-z]+-?\d* ?/gi, " ")
      .replace(/[{}]/g, " ")
      .replace(/\s+/g, " "),
  );
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function extractPptxXmlText(xml: string) {
  const textRuns = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean);

  return normalizeWhitespace(textRuns.join(" "));
}

function getPptxPartNumber(path: string) {
  return Number.parseInt(path.match(/(\d+)\.xml$/)?.[1] ?? "0", 10);
}

function getSortedPptxParts(zip: JSZip, pattern: RegExp) {
  const parts: string[] = [];

  zip.forEach((path, file) => {
    if (!file.dir && pattern.test(path)) {
      parts.push(path);
    }
  });

  return parts.sort((left, right) => getPptxPartNumber(left) - getPptxPartNumber(right));
}

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function shouldUsePptxVisualExtraction(params: {
  slideCount: number;
  mediaCount: number;
  slides: Array<{ text: string }>;
}) {
  if (params.slideCount === 0 || params.mediaCount === 0) {
    return false;
  }

  const totalWords = params.slides.reduce((sum, slide) => sum + countWords(slide.text), 0);
  const averageWordsPerSlide = totalWords / Math.max(params.slideCount, 1);
  const weakSlideCount = params.slides.filter((slide) => countWords(slide.text) < 18).length;
  const weakSlideRatio = weakSlideCount / Math.max(params.slideCount, 1);

  return (
    totalWords < 120 ||
    averageWordsPerSlide < 30 ||
    weakSlideRatio >= 0.35 ||
    params.mediaCount >= Math.ceil(params.slideCount / 2)
  );
}

function mergePptxVisualSlides(params: {
  extractedSlides: Array<{ pageNumber: number; text: string }>;
  visualSlides: Array<{ slideNumber: number; text: string }>;
}) {
  const extractedBySlide = new Map(
    params.extractedSlides.map((slide) => [slide.pageNumber, slide.text]),
  );
  const visualBySlide = new Map(
    params.visualSlides.map((slide) => [slide.slideNumber, normalizeWhitespace(slide.text)]),
  );
  const slideNumbers = Array.from(
    new Set([...extractedBySlide.keys(), ...visualBySlide.keys()]),
  ).sort((left, right) => left - right);

  return slideNumbers.flatMap((slideNumber) => {
    const extractedText = extractedBySlide.get(slideNumber) ?? "";
    const visualText = visualBySlide.get(slideNumber) ?? "";
    const text = extractedText
      ? [extractedText, visualText ? `Visual context: ${visualText}` : ""]
          .filter(Boolean)
          .join("\n")
      : visualText;
    const normalized = normalizeWhitespace(text);

    return normalized
      ? [
          {
            pageNumber: slideNumber,
            text: normalized,
          },
        ]
      : [];
  });
}

async function extractVisualTextFromPptx(file: File, slideCount: number) {
  const env = getServerEnv();
  return generateStructuredObjectWithGeminiFile({
    schema: pptxVisualExtractionSchema,
    instructions: `Analyze this PowerPoint presentation slide by slide.

For each slide, extract the full study-relevant meaning, not just editable text.
Include:
- visible text, labels, captions, tables, and speaker notes
- text inside screenshots or images
- diagram relationships, arrows, sequences, cause/effect, comparisons, and visual groupings
- concise descriptions of important visual-only information

Preserve the source language. Do not summarize the whole deck into one answer. Return one item per slide, using slideNumber 1 through ${slideCount}. If a slide is decorative or empty, return a short factual note that it has no study-relevant content.`,
    file,
    model: env.GEMINI_TEXT_MODEL,
    maxOutputTokens: PPTX_VISUAL_EXTRACTION_MAX_OUTPUT_TOKENS,
    maxAttempts: 2,
    mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
  });
}

async function extractTextFromPptx(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = getSortedPptxParts(zip, /^ppt\/slides\/slide\d+\.xml$/);
  const notePaths = getSortedPptxParts(zip, /^ppt\/notesSlides\/notesSlide\d+\.xml$/);
  const mediaPaths = getSortedPptxParts(zip, /^ppt\/media\/.+/);
  const notesBySlideNumber = new Map<number, string>();

  await Promise.all(
    notePaths.map(async (path) => {
      const noteXml = await zip.file(path)?.async("string");
      const noteText = noteXml ? extractPptxXmlText(noteXml) : "";

      if (noteText) {
        notesBySlideNumber.set(getPptxPartNumber(path), noteText);
      }
    }),
  );

  const slides = (
    await Promise.all(
      slidePaths.map(async (path) => {
        const slideNumber = getPptxPartNumber(path);
        const slideXml = await zip.file(path)?.async("string");
        const slideText = slideXml ? extractPptxXmlText(slideXml) : "";
        const noteText = notesBySlideNumber.get(slideNumber);
        const text = [slideText, noteText ? `Speaker notes: ${noteText}` : ""]
          .filter(Boolean)
          .join("\n");

        return {
          pageNumber: slideNumber,
          text: normalizeWhitespace(text),
        };
      }),
    )
  ).filter((slide) => slide.text.length > 0);
  const slideCount = slidePaths.length;
  const shouldUseVisualExtraction = shouldUsePptxVisualExtraction({
    slideCount,
    mediaCount: mediaPaths.length,
    slides,
  });
  let titleFromVisual: string | null = null;
  let mergedSlides = slides;

  if (shouldUseVisualExtraction) {
    try {
      const visualExtraction = await extractVisualTextFromPptx(file, slideCount);
      titleFromVisual = visualExtraction.title;
      mergedSlides = mergePptxVisualSlides({
        extractedSlides: slides,
        visualSlides: visualExtraction.slides,
      });
    } catch (error) {
      console.warn("PPTX visual extraction failed; using editable slide text only.", error);
    }
  }

  const text = normalizeWhitespace(
    mergedSlides
      .map((slide) => `Slide ${slide.pageNumber}\n${slide.text}`)
      .join("\n\n"),
  );
  const title =
    titleFromVisual ||
    mergedSlides[0]?.text
      .split(/[.!?\n]/)
      .map((line) => line.trim())
      .find((line) => line.length >= 4 && line.length <= 120) ||
    file.name.replace(/\.pptx$/i, "") ||
    "PowerPoint presentation";

  return {
    title,
    text,
    pages: mergedSlides,
  };
}

async function createEmbeddings(texts: string[]) {
  return createAiEmbeddings(texts);
}

function extractTitle(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function extractMetaDescription(html: string) {
  const metaMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  return metaMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, codepoint: string) => {
      const value = Number(codepoint);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => {
      const value = Number.parseInt(codepoint, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    });
}

function extractPageMainHtml(html: string) {
  const wikipediaContentStart = html.search(/<div\b[^>]+id=["']mw-content-text["'][^>]*>/i);

  if (wikipediaContentStart >= 0) {
    const rest = html.slice(wikipediaContentStart);
    const endCandidates = [
      rest.search(/<div\b[^>]+id=["']catlinks["'][^>]*>/i),
      rest.search(/<div\b[^>]+class=["'][^"']*\bprintfooter\b[^"']*["'][^>]*>/i),
      rest.search(/<footer\b/i),
    ].filter((index) => index > 0);
    const end = endCandidates.length > 0 ? Math.min(...endCandidates) : rest.length;

    return rest.slice(0, end);
  }

  const articleMatch = html.match(/<article\b[\s\S]*?<\/article>/i);

  if (articleMatch?.[0]) {
    return articleMatch[0];
  }

  const mainMatch = html.match(/<main\b[\s\S]*?<\/main>/i);

  if (mainMatch?.[0]) {
    return mainMatch[0];
  }

  const roleMainMatch = html.match(/<[^>]+\brole=["']main["'][^>]*>[\s\S]*?<\/[^>]+>/i);

  return roleMainMatch?.[0] ?? html;
}

function stripNoisyHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<button[\s\S]*?<\/button>/gi, " ")
    .replace(/<select[\s\S]*?<\/select>/gi, " ")
    .replace(
      /<table\b[^>]*(?:class|id)=["'][^"']*(?:infobox|navbox|metadata|sidebar|ambox|vertical-navbox)[^"']*["'][\s\S]*?<\/table>/gi,
      " ",
    )
    .replace(
      /<(?:div|section|ul|ol)\b[^>]*(?:class|id)=["'][^"']*(?:toc|reference|references|reflist|mw-editsection|mw-empty-elt|noprint|hatnote|portal|printfooter|catlinks|vector-page-toolbar)[^"']*["'][\s\S]*?<\/(?:div|section|ul|ol)>/gi,
      " ",
    )
    .replace(/<sup\b[^>]*(?:class|id)=["'][^"']*(?:reference|mw-ref)[^"']*["'][\s\S]*?<\/sup>/gi, " ");
}

function isNoisyReadableLine(line: string) {
  const normalized = line.trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return true;
  }

  if (/^\[\s*\d+\s*\]$/.test(normalized) || /^\d+$/.test(normalized)) {
    return true;
  }

  if (/^\{\{[^}]+}}$/.test(normalized)) {
    return true;
  }

  return [
    "pojdi na vsebino",
    "glavni meni",
    "navigacija",
    "iskanje",
    "išči",
    "videz",
    "ustvari račun",
    "prijava",
    "osebna orodja",
    "orodja",
    "dejanja",
    "splošno",
    "tiskanje/izvoz",
    "v drugih projektih",
    "uredi povezave",
    "preberi",
    "uredi stran",
    "uredi kodo",
    "zgodovina",
    "vklopi kazalo vsebine",
    "iz wikipedije, proste enciklopedije",
  ].includes(lower);
}

function cleanReadableWebpageText(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isNoisyReadableLine(line));
  const cleanedLines: string[] = [];

  for (const line of lines) {
    if (line === cleanedLines[cleanedLines.length - 1]) {
      continue;
    }

    cleanedLines.push(line);
  }

  return normalizeWhitespace(cleanedLines.join("\n\n"));
}

function htmlToText(html: string) {
  return normalizeWhitespace(
    stripNoisyHtml(extractPageMainHtml(html))
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " "),
  );
}

function parseIpv4Address(value: string) {
  const octets = value.split(".").map((part) => Number(part));

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return octets.reduce((accumulator, octet) => (accumulator << 8) + octet, 0) >>> 0;
}

function isIpv4InCidr(value: number, base: string, bits: number) {
  const baseAddress = parseIpv4Address(base);

  if (baseAddress == null) {
    return true;
  }

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;

  return (value & mask) === (baseAddress & mask);
}

function isDisallowedIpv4Address(value: string) {
  const address = parseIpv4Address(value);

  if (address == null) {
    return true;
  }

  const disallowedRanges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return disallowedRanges.some(([base, bits]) => isIpv4InCidr(address, base, bits));
}

function expandIpv6(value: string) {
  if (!value.includes("::")) {
    return value.split(":");
  }

  const [left, right] = value.split("::");
  const leftParts = left.length > 0 ? left.split(":") : [];
  const rightParts = right.length > 0 ? right.split(":") : [];
  const missingGroups = 8 - (leftParts.length + rightParts.length);

  return [
    ...leftParts,
    ...Array.from({ length: Math.max(missingGroups, 0) }, () => "0"),
    ...rightParts,
  ];
}

function isDisallowedIpv6Address(value: string) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized.includes(".")) {
    if (!normalized.startsWith("::ffff:")) {
      return true;
    }

    const mappedIpv4 = normalized.split(":").pop();
    return !mappedIpv4 || isDisallowedIpv4Address(mappedIpv4);
  }

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const groups = expandIpv6(normalized).map((part) => part.padStart(4, "0"));
  const firstGroup = Number.parseInt(groups[0] ?? "0", 16);
  const secondGroup = Number.parseInt(groups[1] ?? "0", 16);

  if (!Number.isFinite(firstGroup) || !Number.isFinite(secondGroup)) {
    return true;
  }

  const isIpv4Mapped =
    groups.slice(0, 5).every((part) => part === "0000") && groups[5] === "ffff";

  if (isIpv4Mapped) {
    const high = Number.parseInt(groups[6] ?? "0", 16);
    const low = Number.parseInt(groups[7] ?? "0", 16);

    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      return true;
    }

    return isDisallowedIpv4Address(
      `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`,
    );
  }

  if ((firstGroup & 0xe000) !== 0x2000) {
    return true;
  }

  return (
    (firstGroup === 0x2001 && (secondGroup & 0xfe00) === 0x0000) ||
    (firstGroup === 0x2001 && secondGroup === 0x0db8) ||
    firstGroup === 0x2002
  );
}

function isDisallowedIpAddress(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);

  if (version === 4) {
    return isDisallowedIpv4Address(normalized);
  }

  if (version === 6) {
    return isDisallowedIpv6Address(normalized);
  }

  return true;
}

async function assertPublicHostname(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local")
  ) {
    throw new Error("Private network addresses are not allowed.");
  }

  if (isIP(normalizedHostname) !== 0) {
    if (isDisallowedIpAddress(normalizedHostname)) {
      throw new Error("Private network addresses are not allowed.");
    }

    return;
  }

  const addresses = await lookup(normalizedHostname, { all: true, verbatim: true });

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isDisallowedIpAddress(entry.address))
  ) {
    throw new Error("Private network addresses are not allowed.");
  }
}

function resolveRedirectUrl(baseUrl: URL, location: string) {
  try {
    return new URL(location, baseUrl);
  } catch {
    throw new Error("The link returned an invalid redirect.");
  }
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("The linked page is too large to import.");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        throw new Error("The linked page is too large to import.");
      }

      body += decoder.decode(value, { stream: true });
    }

    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return body;
}

async function fetchReadableWebpageResponse(targetUrl: URL, redirectCount = 0): Promise<{
  url: URL;
  response: Response;
}> {
  if (redirectCount > MAX_LINK_FETCH_REDIRECTS) {
    throw new Error("Too many redirects. Use the final page URL directly.");
  }

  await assertPublicHostname(targetUrl.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MemoAI/1.0; +https://memoai.eu)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("The link returned an invalid redirect.");
      }

      const nextUrl = resolveRedirectUrl(targetUrl, location);

      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        throw new Error("Only http and https links are supported.");
      }

      return fetchReadableWebpageResponse(nextUrl, redirectCount + 1);
    }

    return {
      url: targetUrl,
      response,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The link took too long to respond.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchReadableWebpage(params: { url: string }) {
  const targetUrl = new URL(params.url);
  const { response } = await fetchReadableWebpageResponse(targetUrl);

  if (!response.ok) {
    throw new Error("The link could not be loaded.");
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (isUnsupportedVideoContentType(contentType)) {
    throw new Error(UNSUPPORTED_VIDEO_LINK_MESSAGE);
  }

  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("Only standard web pages are supported for link summaries.");
  }

  const html = await readResponseBodyWithLimit(response, MAX_LINK_FETCH_BYTES);
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const text = cleanReadableWebpageText(decodeBasicHtmlEntities(htmlToText(html)));
  const composed = normalizeWhitespace(
    [title, description, text].filter(Boolean).join("\n\n"),
  );

  if (composed.length < 200) {
    throw new Error("This page does not contain enough readable text to summarize.");
  }

  return {
    title,
    text: composed.slice(0, MAX_LINK_READABLE_TEXT_CHARS),
  };
}

export async function extractTextFromPdf(file: File) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: fileBytes,
      useWorkerFetch: false,
      isEvalSupported: false,
    });

    try {
      const document = await loadingTask.promise;

      try {
        const [metadata, pageTexts] = await Promise.all([
          document.getMetadata().catch(() => null),
          Promise.all(
            Array.from({ length: document.numPages }, async (_, pageIndex) => {
              const page = await document.getPage(pageIndex + 1);

              try {
                const textContent = await page.getTextContent();
                const pageText = textContent.items.reduce<string[]>(
                  (accumulator, item) => {
                    if (!isPdfTextItem(item)) {
                      return accumulator;
                    }

                    const value = item.str.trim();

                    if (!value) {
                      return accumulator;
                    }

                    accumulator.push(item.hasEOL ? `${value}\n` : value);

                    return accumulator;
                  },
                  [],
                );

                return {
                  pageNumber: pageIndex + 1,
                  text: normalizeWhitespace(pageText.join(" ")),
                };
              } finally {
                page.cleanup();
              }
            }),
          ),
        ]);

        const parsedText = normalizeWhitespace(
          pageTexts.map((page) => page.text).filter(Boolean).join("\n\n"),
        );
        const metadataTitle =
          (typeof metadata?.info === "object" &&
          metadata.info !== null &&
          "Title" in metadata.info &&
          typeof metadata.info.Title === "string"
            ? metadata.info.Title.replace(/\s+/g, " ").trim()
            : "") ||
          file.name.replace(/\.pdf$/i, "");

        if (parsedText.split(/\s+/).filter(Boolean).length >= 40) {
          return {
            title: metadataTitle || "PDF document",
            text: parsedText,
            pages: pageTexts.filter((page) => page.text.length > 0),
          };
        }
      } finally {
        await document.cleanup();
        await document.destroy();
      }
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    console.warn("PDF.js extraction failed, falling back to Gemini file extraction.", error);
  }

  const fallbackInstructions =
    "Extract as much readable text from this PDF as possible into plain text. Do not summarize. Preserve the source language, preserve examples and important details, and ignore repeated headers, footers, and page numbers when possible. Return a concise title plus the document text.";
  const env = getServerEnv();
  const fallback = await generateStructuredObjectWithGeminiFile({
    schema: pdfExtractionSchema,
    instructions: `${fallbackInstructions}\n\nExtract the document text as faithfully and completely as possible so it can be turned into detailed study notes and flashcards.`,
    file,
    model: env.GEMINI_TEXT_MODEL,
    maxOutputTokens: 7000,
  });

  return {
    title: fallback.title,
    text: normalizeWhitespace(fallback.text),
    pages: [],
  };
}

export async function extractTextFromDocument(file: File) {
  if (isPdfDocument(file)) {
    return extractTextFromPdf(file);
  }

  if (isPlainTextDocument(file)) {
    const text = normalizeWhitespace(await file.text());
    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "Text document",
      text,
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isHtmlDocument(file)) {
    const html = await file.text();
    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "HTML document",
      text: htmlToText(html),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isRtfDocument(file)) {
    const rtf = await file.text();
    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "RTF dokument",
      text: rtfToText(rtf),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isDocxDocument(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await mammoth.extractRawText({ buffer });

    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "Word dokument",
      text: normalizeWhitespace(extracted.value),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isPptxDocument(file)) {
    return extractTextFromPptx(file);
  }

  throw new Error("Nepodprta vrsta dokumenta. Uporabi PDF, TXT, Markdown, HTML, RTF, DOCX ali PPTX.");
}

export async function extractTextFromImage(file: File, context?: ImageOcrContext) {
  const env = getServerEnv();
  const instructions =
    "Extract all readable text from this photo of notes or printed material. The source is likely Slovenian, so preserve Slovenian characters such as č, š, and ž. Do not translate and do not summarize. Preserve the original language, headings, bullet points, equations, labels, line breaks, and important details. Ignore decorative background elements. If handwriting is uncertain, make the best faithful reading instead of inventing content. Return only the extracted text. Do not include JSON, markdown fences, commentary, or confidence notes.";
  const attempts: ScanOcrAttemptDiagnostics[] = [];

  let primaryError: unknown = null;

  try {
    const primaryText = await generateTextWithGeminiFile({
      instructions,
      file,
      model: env.GEMINI_OCR_MODEL,
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      maxAttempts: 1,
      thinkingConfig: OCR_THINKING_CONFIG,
      mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
      usageContext: buildImageOcrUsageContext({
        context,
        stage: "ocr_primary",
        file,
      }),
    });
    const text = normalizeOcrPlainText(primaryText);
    const acceptable = isAcceptableImageOcrText(text);
    attempts.push({
      acceptable,
      errorMessage: null,
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      mediaResolution: "medium",
      model: env.GEMINI_OCR_MODEL,
      outputLength: text.length,
      stage: "ocr_primary",
    });

    if (acceptable) {
      return {
        title: deriveImageTitle(file, text),
        text,
      };
    }
  } catch (error) {
    primaryError = error;
    attempts.push({
      acceptable: null,
      errorMessage: toSafeErrorMessage(error),
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      mediaResolution: "medium",
      model: env.GEMINI_OCR_MODEL,
      outputLength: null,
      stage: "ocr_primary",
    });
  }

  try {
    const rescueText = await generateTextWithGeminiFile({
      instructions,
      file,
      model: env.GEMINI_OCR_RESCUE_MODEL,
      maxOutputTokens: OCR_RESCUE_MAX_OUTPUT_TOKENS,
      maxAttempts: 1,
      thinkingConfig: OCR_THINKING_CONFIG,
      mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
      usageContext: buildImageOcrUsageContext({
        context,
        stage: "ocr_rescue",
        file,
      }),
    });
    const text = normalizeOcrPlainText(rescueText);
    const acceptable = isAcceptableImageOcrText(text);
    attempts.push({
      acceptable,
      errorMessage: null,
      maxOutputTokens: OCR_RESCUE_MAX_OUTPUT_TOKENS,
      mediaResolution: "high",
      model: env.GEMINI_OCR_RESCUE_MODEL,
      outputLength: text.length,
      stage: "ocr_rescue",
    });

    if (!acceptable) {
      if (primaryError) {
        throw new Error(toUserFacingAiErrorMessage(primaryError));
      }

      throw new NoReadableScanTextError({
        imageCount: 1,
        images: [
          {
            attempts,
            fileName: file.name,
            imageIndex: context?.imageIndex ?? null,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
        ],
        readableImageCount: 0,
        skippedImageCount: 1,
      });
    }

    return {
      title: deriveImageTitle(file, text),
      text,
    };
  } catch (error) {
    if (error instanceof NoReadableScanTextError) {
      throw error;
    }

    throw new Error(toUserFacingAiErrorMessage(primaryError ?? error));
  }
}

export async function createLectureFromTextSource(params: {
  userId: string;
  sourceType: string;
  text: string;
  blocks?: StructuredSourceBlock[];
  languageHint?: string;
  titleHint?: string;
  modelMetadata?: Record<string, unknown>;
  lectureId?: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const cleanedText = normalizeWhitespace(params.text);

  if (cleanedText.length < 120) {
    throw new Error("Please provide a bit more source material before creating notes.");
  }

  const durationSeconds = estimateTextSourceDurationSeconds(cleanedText);
  let lectureId: string | null = null;

  async function requireActiveLecture(targetLectureId: string) {
    const { data: lecture, error } = await supabase
      .from("lectures")
      .select("id")
      .eq("id", targetLectureId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!lecture) {
      throw new Error("Lecture was cancelled.");
    }
  }

  try {
    if (params.lectureId) {
      lectureId = params.lectureId;
      await requireActiveLecture(lectureId);
      const { error: lectureUpdateError } = await supabase
        .from("lectures")
        .update(
          {
            source_type: params.sourceType,
            status: "generating_notes",
            language_hint: params.languageHint ?? "sl",
            duration_seconds: durationSeconds,
            error_message: null,
            title: params.titleHint ?? null,
            processing_metadata: {
              manualImport: {
                sourceType: params.sourceType,
                titleHint: params.titleHint ?? null,
                modelMetadata: params.modelMetadata ?? {},
                text: cleanedText,
                blocks: params.blocks ?? null,
              },
            },
          } as never,
        )
        .eq("id", lectureId)
        .eq("user_id", params.userId);

      if (lectureUpdateError) {
        throw new Error(lectureUpdateError.message);
      }
    } else {
      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .insert(
          {
            user_id: params.userId,
            source_type: params.sourceType,
            status: "generating_notes",
            language_hint: params.languageHint ?? "sl",
            duration_seconds: durationSeconds,
            title: params.titleHint ?? null,
            processing_metadata: {
              manualImport: {
                sourceType: params.sourceType,
                titleHint: params.titleHint ?? null,
                modelMetadata: params.modelMetadata ?? {},
                text: cleanedText,
                blocks: params.blocks ?? null,
              },
            },
          } as never,
        )
        .select("id")
        .single();

      if (lectureError || !lecture) {
        throw new Error(lectureError?.message ?? "Zapiska ni bilo mogoče ustvariti.");
      }

      lectureId = (lecture as { id: string }).id;
    }
    const transcript = buildSyntheticTranscriptFromTextSource({
      text: cleanedText,
      blocks: params.blocks,
      sourceType: params.sourceType,
    });

    if (transcript.length === 0) {
      throw new Error("The source did not contain enough text to process.");
    }

    if (!lectureId) {
      throw new Error("Zapiska ni bilo mogoče ustvariti.");
    }

    const activeLectureId = lectureId;
    const embeddings = await createEmbeddings(transcript.map((segment) => segment.text));

    await requireActiveLecture(activeLectureId);

    await supabase.from("transcript_segments").delete().eq("lecture_id", activeLectureId);

    const transcriptRows = transcript.map((segment, index) => ({
      lecture_id: activeLectureId,
      idx: segment.idx,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker_label: segment.speakerLabel,
      text: segment.text,
      embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
    }));

    await insertTranscriptSegmentsInBatches(supabase, transcriptRows);

    const notes = await generateNotesFromTranscript(transcript, {
      sourceLabel: "uploaded documents and text sources",
      pipelineName: "document-to-notes-v2",
      sourceType: "document",
      outputLanguage: params.languageHint,
      sourceTitleHint: params.titleHint,
    });

    await requireActiveLecture(lectureId);

    const { error: artifactError } = await supabase
      .from("lecture_artifacts")
      .upsert(
        {
          lecture_id: lectureId,
          summary: notes.summary,
          key_topics: notes.keyTopics,
          structured_notes_md: notes.structuredNotesMd,
          model_metadata: {
            ...notes.modelMetadata,
            ...params.modelMetadata,
          },
        } as never,
        {
          onConflict: "lecture_id",
        },
      );

    if (artifactError) {
      throw new Error(artifactError.message);
    }

    const { data: updatedLecture, error: updateError } = await supabase
      .from("lectures")
      .update(
        {
          title: notes.title,
          status: "ready",
          error_message: null,
          duration_seconds: durationSeconds,
        } as never,
      )
      .eq("id", lectureId)
      .select("id")
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updatedLecture) {
      await requireActiveLecture(lectureId);
    }

    return lectureId;
  } catch (error) {
    if (lectureId) {
      const { data: lecture } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", lectureId)
        .maybeSingle();

      if (lecture) {
        await supabase
          .from("lectures")
          .update(
            {
              status: "failed",
              error_message: toUserFacingAiErrorMessage(error),
            } as never,
          )
          .eq("id", lectureId);
      }
    }

    throw error;
  }
}

export async function prepareLectureFromTextSource(params: {
  userId: string;
  sourceType: string;
  text: string;
  blocks?: StructuredSourceBlock[];
  languageHint?: string;
  titleHint?: string;
  modelMetadata?: Record<string, unknown>;
  lectureId?: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const cleanedText = normalizeWhitespace(params.text);

  if (cleanedText.length < 120) {
    throw new Error("Please provide a bit more source material before creating notes.");
  }

  const durationSeconds = estimateTextSourceDurationSeconds(cleanedText);
  const processingMetadata = {
    manualImport: {
      sourceType: params.sourceType,
      titleHint: params.titleHint ?? null,
      modelMetadata: params.modelMetadata ?? {},
      text: cleanedText,
      blocks: params.blocks ?? null,
    },
    processing: {
      stage: "queued",
      updatedAt: new Date().toISOString(),
      errorMessage: null,
    },
  };

  if (params.lectureId) {
    const { data: lecture, error } = await supabase
      .from("lectures")
      .update(
        {
          source_type: params.sourceType,
          status: "queued",
          language_hint: params.languageHint ?? "sl",
          duration_seconds: durationSeconds,
          error_message: null,
          title: params.titleHint ?? null,
          processing_metadata: processingMetadata,
        } as never,
      )
      .eq("id", params.lectureId)
      .eq("user_id", params.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!lecture) {
      throw new Error("Lecture was cancelled.");
    }

    const [{ error: transcriptDeleteError }, { error: artifactDeleteError }] = await Promise.all([
      supabase.from("transcript_segments").delete().eq("lecture_id", params.lectureId),
      supabase.from("lecture_artifacts").delete().eq("lecture_id", params.lectureId),
    ]);

    if (transcriptDeleteError) {
      throw new Error(transcriptDeleteError.message);
    }

    if (artifactDeleteError) {
      throw new Error(artifactDeleteError.message);
    }

    return params.lectureId;
  }

  const { data: lecture, error } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: params.userId,
        source_type: params.sourceType,
        status: "queued",
        language_hint: params.languageHint ?? "sl",
        duration_seconds: durationSeconds,
        title: params.titleHint ?? null,
        processing_metadata: processingMetadata,
      } as never,
    )
    .select("id")
    .single();

  if (error || !lecture) {
    throw new Error(error?.message ?? "Zapiska ni bilo mogoče ustvariti.");
  }

  return (lecture as { id: string }).id;
}
