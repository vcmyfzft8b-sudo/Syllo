import "server-only";

import mammoth from "mammoth";
import { z } from "zod";

import { generateStructuredObjectWithGeminiFile } from "@/lib/ai/gemini";
import { generateStructuredObject } from "@/lib/ai/json";
import {
  isDocxDocument,
  isHtmlDocument,
  isPdfDocument,
  isPlainTextDocument,
  isRtfDocument,
} from "@/lib/document-files";
import { enqueueLectureProcessingStage } from "@/lib/jobs";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import { getAiProvider, getServerEnv } from "@/lib/server-env";
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
    console.warn("PDF.js extraction failed, falling back to OpenAI file extraction.", error);
  }

  const fallbackInstructions =
    "Extract as much readable text from this PDF as possible into plain text. Do not summarize. Preserve the source language, preserve examples and important details, and ignore repeated headers, footers, and page numbers when possible. Return a concise title plus the document text.";
  const provider = getAiProvider();
  const env = getServerEnv();
  const fallback =
    provider === "gemini"
      ? await generateStructuredObjectWithGeminiFile({
          schema: pdfExtractionSchema,
          instructions: `${fallbackInstructions}\n\nExtract the document text as faithfully and completely as possible so it can be turned into detailed study notes and flashcards.`,
          file,
          model: env.GEMINI_TEXT_MODEL,
          maxOutputTokens: 7000,
        })
      : await generateStructuredObject({
          schema: pdfExtractionSchema,
          schemaName: "pdf_extraction",
          maxOutputTokens: 7000,
          instructions: fallbackInstructions,
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
                  file_data: `data:${file.type || "application/pdf"};base64,${buffer.toString("base64")}`,
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
      title: file.name.replace(/\.[^.]+$/i, "") || "RTF document",
      text: rtfToText(rtf),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isDocxDocument(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await mammoth.extractRawText({ buffer });

    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "Word document",
      text: normalizeWhitespace(extracted.value),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  throw new Error("Unsupported document type. Use PDF, TXT, Markdown, HTML, RTF, or DOCX.");
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
        throw new Error(lectureError?.message ?? "Could not create note.");
      }

      lectureId = (lecture as { id: string }).id;
    }
    if (
      await enqueueLectureProcessingStage({
        lectureId,
        stage: "generate_notes",
      })
    ) {
      return lectureId;
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
              error_message:
                error instanceof Error ? error.message : "Unknown processing error.",
            } as never,
          )
          .eq("id", lectureId);
      }
    }

    throw error;
  }
}
