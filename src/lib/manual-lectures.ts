import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import { enqueueLectureStudyGeneration } from "@/lib/jobs";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { TranscriptSegmentInput } from "@/lib/types";
import { getOpenAiClient } from "@/lib/ai/openai";
import { getServerEnv } from "@/lib/server-env";
import { serializeVector } from "@/lib/utils";

const pdfExtractionSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(120),
});

type StructuredSourceBlock = {
  label: string | null;
  pageNumber: number | null;
  text: string;
};

const DOCUMENT_SOURCE_MAX_CHARS = 560;

let pdfJsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null =
  null;

async function getPdfJs() {
  if (!pdfJsPromise) {
    const pdfGlobal = globalThis as typeof globalThis & {
      self?: typeof globalThis;
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

function estimateDurationSeconds(text: string) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.round(wordCount / 2.6), 1);
}

function splitLongBlock(paragraph: string, maxChars = 850) {
  const normalized = paragraph.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    const words = normalized.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let activeWords: string[] = [];

    for (const word of words) {
      const next = [...activeWords, word].join(" ");
      if (next.length > maxChars && activeWords.length > 0) {
        chunks.push(activeWords.join(" "));
        activeWords = [word];
        continue;
      }

      activeWords.push(word);
    }

    if (activeWords.length > 0) {
      chunks.push(activeWords.join(" "));
    }

    return chunks;
  }

  const chunks: string[] = [];
  let activeChunk = "";

  for (const sentence of sentenceParts) {
    const next = activeChunk ? `${activeChunk} ${sentence}` : sentence;

    if (next.length > maxChars && activeChunk) {
      chunks.push(activeChunk);
      activeChunk = sentence;
      continue;
    }

    activeChunk = next;
  }

  if (activeChunk) {
    chunks.push(activeChunk);
  }

  return chunks;
}

function normalizeStructuredBlocks(blocks: StructuredSourceBlock[]) {
  return blocks.flatMap((block) => {
    const normalizedText = normalizeWhitespace(block.text);
    if (!normalizedText) {
      return [];
    }

    return splitLongBlock(normalizedText, DOCUMENT_SOURCE_MAX_CHARS).map((chunk) => ({
      label: block.label?.trim() || null,
      pageNumber: block.pageNumber ?? null,
      text: chunk,
    }));
  });
}

function buildBlocksFromText(params: {
  text: string;
  sourceType: string;
}) {
  const cleanedText = normalizeWhitespace(params.text);
  const paragraphs = cleanedText
    .split(/\n{2,}|\f+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const blocks: StructuredSourceBlock[] = [];
  let activeSection = `${params.sourceType === "link" ? "Section" : "Section"} 1`;
  let sectionIndex = 1;

  for (const paragraph of paragraphs) {
    const normalized = paragraph.trim();
    if (!normalized) {
      continue;
    }

    const headingLike =
      normalized.length <= 90 &&
      (normalized.startsWith("#") ||
        /^[A-Z][A-Z\s0-9:,-]{5,}$/.test(normalized) ||
        /^\d+(\.\d+)*\s+[A-Z]/.test(normalized));

    if (headingLike) {
      sectionIndex += 1;
      activeSection = normalized.replace(/^#+\s*/, "").trim() || `Section ${sectionIndex}`;
      continue;
    }

    for (const chunk of splitLongBlock(normalized, DOCUMENT_SOURCE_MAX_CHARS)) {
      blocks.push({
        label: activeSection,
        pageNumber: null,
        text: chunk,
      });
    }
  }

  if (blocks.length > 0) {
    return blocks;
  }

  return splitLongBlock(cleanedText, DOCUMENT_SOURCE_MAX_CHARS).map((chunk, index) => ({
    label: `Section ${index + 1}`,
    pageNumber: null,
    text: chunk,
  }));
}

function buildSyntheticTranscript(params: {
  text?: string;
  blocks?: StructuredSourceBlock[];
  sourceType: string;
}): TranscriptSegmentInput[] {
  const blocks = params.blocks?.length
    ? normalizeStructuredBlocks(params.blocks)
    : buildBlocksFromText({
        text: params.text ?? "",
        sourceType: params.sourceType,
      });
  const segments: TranscriptSegmentInput[] = [];
  let startMs = 0;
  let elapsedMs = 0;

  for (const block of blocks) {
    const durationMs = Math.max(
      Math.round(block.text.split(/\s+/).filter(Boolean).length * 420),
      6000,
    );

    segments.push({
      idx: segments.length,
      startMs,
      endMs: startMs + durationMs,
      speakerLabel:
        block.pageNumber != null
          ? block.label
            ? `Page ${block.pageNumber} · ${block.label}`
            : `Page ${block.pageNumber}`
          : block.label,
      text: block.text,
    });

    elapsedMs += durationMs;
    startMs = elapsedMs;
  }

  if (segments.length > 0) {
    return segments;
  }

  const cleanedText = normalizeWhitespace(params.text ?? "");
  if (!cleanedText) {
    return [];
  }

  const fallbackDuration = Math.max(
    Math.round(cleanedText.split(/\s+/).filter(Boolean).length * 420),
    6000,
  );

  return [
    {
      idx: 0,
      startMs: 0,
      endMs: fallbackDuration,
      speakerLabel: null,
      text: cleanedText,
    },
  ];
}

async function createEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const openai = getOpenAiClient();
  const response = await openai.embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
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

export async function fetchReadableWebpage(params: { url: string }) {
  const response = await fetch(params.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; NotaBot/1.0; +https://nota.local)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error("The link could not be loaded.");
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("Only standard web pages are supported for link summaries.");
  }

  const html = await response.text();
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
  const buffer = Buffer.from(fileBytes);
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: fileBytes,
      disableWorker: true,
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

        if (parsedText.split(/\s+/).filter(Boolean).length >= 250) {
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
    console.warn("PDF.js extraction failed, falling back to OpenAI file extraction.", error);
  }

  const base64 = buffer.toString("base64");
  const fallback = await generateStructuredObject({
    schema: pdfExtractionSchema,
    schemaName: "pdf_extraction",
    maxOutputTokens: 7000,
    instructions:
      "Extract as much readable text from this PDF as possible into plain text. Do not summarize. Preserve the source language, preserve examples and important details, and ignore repeated headers, footers, and page numbers when possible. Return a concise title plus the document text.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract the document text as faithfully and completely as possible so it can be turned into detailed study notes and flashcards.",
          },
          {
            type: "input_file",
            filename: file.name,
            file_data: `data:${file.type || "application/pdf"};base64,${base64}`,
          },
        ],
      },
    ],
  });

  return {
    title: fallback.title,
    text: normalizeWhitespace(fallback.text),
    pages: [],
  };
}

export async function createLectureFromTextSource(params: {
  userId: string;
  sourceType: string;
  text: string;
  blocks?: StructuredSourceBlock[];
  languageHint?: string;
  titleHint?: string;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const cleanedText = normalizeWhitespace(params.text);

  if (cleanedText.length < 120) {
    throw new Error("Please provide a bit more source material before creating notes.");
  }

  const transcript = buildSyntheticTranscript({
    text: cleanedText,
    blocks: params.blocks,
    sourceType: params.sourceType,
  });

  if (transcript.length === 0) {
    throw new Error("The source did not contain enough text to process.");
  }

  const durationSeconds = estimateDurationSeconds(cleanedText);
  let lectureId: string | null = null;

  try {
    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .insert(
        {
          user_id: params.userId,
          source_type: params.sourceType,
          status: "generating_notes",
          language_hint: params.languageHint ?? "sl",
          duration_seconds: durationSeconds,
        } as never,
      )
      .select("id")
      .single();

    if (lectureError || !lecture) {
      throw new Error(lectureError?.message ?? "Could not create note.");
    }

    lectureId = (lecture as { id: string }).id;

    const embeddings = await createEmbeddings(transcript.map((segment) => segment.text));
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
      outputLanguage: params.languageHint,
      sourceTitleHint: params.titleHint,
    });
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

    const { error: updateError } = await supabase
      .from("lectures")
      .update(
        {
          title: notes.title,
          status: "ready",
          error_message: null,
          duration_seconds: durationSeconds,
        } as never,
      )
      .eq("id", lectureId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await enqueueLectureStudyGeneration(lectureId);

    return lectureId;
  } catch (error) {
    if (lectureId) {
      await supabase
        .from("lectures")
        .update(
          {
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown processing error.",
          } as never,
        )
        .eq("id", lectureId);
    }

    throw error;
  }
}
