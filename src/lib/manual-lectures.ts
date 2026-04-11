import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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
  isRtfDocument,
} from "@/lib/document-files";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  buildSyntheticTranscriptFromTextSource,
  estimateTextSourceDurationSeconds,
  type StructuredSourceBlock,
} from "@/lib/text-source-processing";
import { createEmbeddings as createAiEmbeddings } from "@/lib/ai/embeddings";
import { serializeVector } from "@/lib/utils";

const pdfExtractionSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(120),
});

const imageExtractionSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
});

const MAX_LINK_FETCH_REDIRECTS = 3;
const MAX_LINK_FETCH_BYTES = 1_000_000;
const LINK_FETCH_TIMEOUT_MS = 10_000;

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

function htmlToText(html: string) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

function isPrivateIpv4(value: string) {
  const octets = value.split(".").map((part) => Number(part));

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
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

function isPrivateIpv6(value: string) {
  const normalized = value.toLowerCase();

  if (normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  const groups = expandIpv6(normalized).map((part) => part.padStart(4, "0"));
  const firstGroup = Number.parseInt(groups[0] ?? "0", 16);

  return (firstGroup & 0xfe00) === 0xfc00;
}

function isDisallowedIpAddress(value: string) {
  const version = isIP(value);

  if (version === 4) {
    return isPrivateIpv4(value);
  }

  if (version === 6) {
    return isPrivateIpv6(value);
  }

  return true;
}

async function assertPublicHostname(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase();

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
          "Mozilla/5.0 (compatible; NotaBot/1.0; +https://nota.local)",
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

  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("Only standard web pages are supported for link summaries.");
  }

  const html = await readResponseBodyWithLimit(response, MAX_LINK_FETCH_BYTES);
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const text = htmlToText(html);
  const composed = normalizeWhitespace(
    [title, description, text].filter(Boolean).join("\n\n"),
  );

  if (composed.length < 200) {
    throw new Error("This page does not contain enough readable text to summarize.");
  }

  return {
    title,
    text: composed.slice(0, 120000),
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

  throw new Error("Nepodprta vrsta dokumenta. Uporabi PDF, TXT, Markdown, HTML, RTF ali DOCX.");
}

export async function extractTextFromImage(file: File) {
  const env = getServerEnv();
  const instructions =
    "Extract all readable text from this photo of notes or printed material. Do not summarize. Preserve the original language, headings, bullet points, equations, labels, and important details. Ignore decorative background elements. If handwriting is uncertain, make the best faithful reading instead of inventing content. Return a short title and the extracted text.";

  try {
    const extracted = await generateStructuredObjectWithGeminiFile({
      schema: imageExtractionSchema,
      instructions,
      file,
      model: env.GEMINI_TEXT_MODEL,
      maxOutputTokens: 6000,
    });

    return {
      title: extracted.title,
      text: normalizeWhitespace(extracted.text),
    };
  } catch (error) {
    const fallbackText = await generateTextWithGeminiFile({
      instructions: `${instructions}

Return plain text only in exactly this format:
TITLE: <short title>
TEXT:
<full extracted text>`,
      file,
      model: env.GEMINI_TEXT_MODEL,
      maxOutputTokens: 12000,
    });

    const normalizedFallback = fallbackText.replace(/\r\n/g, "\n").trim();
    const titleMatch = normalizedFallback.match(/^TITLE:\s*(.+)$/im);
    const textMatch = normalizedFallback.match(/TEXT:\s*\n([\s\S]*)$/i);
    const extractedText = normalizeWhitespace(textMatch?.[1] ?? normalizedFallback);
    const extractedTitle = titleMatch?.[1]?.trim() || file.name.replace(/\.[^.]+$/i, "") || "Image";

    if (!extractedText) {
      throw new Error(toUserFacingAiErrorMessage(error));
    }

    return {
      title: extractedTitle,
      text: extractedText,
    };
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

    const embeddings = await createEmbeddings(transcript.map((segment) => segment.text));

    await requireActiveLecture(lectureId);

    await supabase.from("transcript_segments").delete().eq("lecture_id", lectureId);

    const transcriptRows = transcript.map((segment, index) => ({
      lecture_id: lectureId,
      idx: segment.idx,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker_label: segment.speakerLabel,
      text: segment.text,
      embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
    }));

    const { error: transcriptError } = await supabase
      .from("transcript_segments")
      .insert(transcriptRows as never);

    if (transcriptError) {
      throw new Error(transcriptError.message);
    }

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
