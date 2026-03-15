import "server-only";

import { z } from "zod";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";
import { getOpenAiClient } from "@/lib/ai/openai";
import { getServerEnv } from "@/lib/server-env";
import { serializeVector } from "@/lib/utils";

const pdfExtractionSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(120),
});

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

function buildSyntheticTranscript(text: string): TranscriptSegmentInput[] {
  const cleanedText = normalizeWhitespace(text);
  const paragraphs = cleanedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const segments: TranscriptSegmentInput[] = [];
  let activeText = "";
  let startMs = 0;
  let elapsedMs = 0;

  const flushSegment = () => {
    const textValue = activeText.trim();

    if (!textValue) {
      return;
    }

    const durationMs = Math.max(
      Math.round(textValue.split(/\s+/).filter(Boolean).length * 420),
      6000,
    );

    segments.push({
      idx: segments.length,
      startMs,
      endMs: startMs + durationMs,
      speakerLabel: null,
      text: textValue,
    });

    elapsedMs += durationMs;
    startMs = elapsedMs;
    activeText = "";
  };

  for (const paragraph of paragraphs) {
    const nextValue = activeText ? `${activeText}\n\n${paragraph}` : paragraph;

    if (nextValue.length > 900 && activeText) {
      flushSegment();
      activeText = paragraph;
      continue;
    }

    activeText = nextValue;
  }

  flushSegment();

  if (segments.length > 0) {
    return segments;
  }

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

async function generateNotesFromTranscript(
  segments: TranscriptSegmentInput[],
): Promise<NoteGenerationResult> {
  const windows = buildTranscriptWindows(segments);
  const chunkOutputs = await Promise.all(
    windows.map((window, index) =>
      generateStructuredObject({
        schema: chunkSummarySchema,
        schemaName: "chunk_summary",
        instructions:
          "You create accurate English study notes from lecture-style source material. Preserve technical terms from the source when they matter. Never invent missing facts.",
        input: `Source chunk ${index + 1}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
      }),
    ),
  );

  return generateStructuredObject({
    schema: noteArtifactSchema,
    schemaName: "note_artifact",
    instructions:
      "You are preparing final study notes in English. Preserve technical terms from the source when they are part of the material, and ground every point in the supplied chunk summaries only. The markdown notes should use headings, bullet points, and concise explanations.",
    input: JSON.stringify(
      {
        chunkSummaries: chunkOutputs,
      },
      null,
      2,
    ),
  }).then((result) => ({
    ...result,
    modelMetadata: {
      chunkCount: chunkOutputs.length,
      pipeline: "document-to-notes-v1",
    },
  }));
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
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  return generateStructuredObject({
    schema: pdfExtractionSchema,
    schemaName: "pdf_extraction",
    instructions:
      "Extract the readable contents of this PDF into plain text. Ignore repeated headers, footers, and page numbers when possible. Preserve the source language and return a concise title plus the main text only.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract the document text so it can be turned into study notes.",
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
}

export async function createLectureFromTextSource(params: {
  userId: string;
  sourceType: string;
  text: string;
  languageHint?: string;
  titleHint?: string;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const cleanedText = normalizeWhitespace(params.text);

  if (cleanedText.length < 120) {
    throw new Error("Please provide a bit more source material before creating notes.");
  }

  const transcript = buildSyntheticTranscript(cleanedText);

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

    const notes = await generateNotesFromTranscript(transcript);
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
          title: params.titleHint?.trim() || notes.title,
          status: "ready",
          error_message: null,
          duration_seconds: durationSeconds,
        } as never,
      )
      .eq("id", lectureId);

    if (updateError) {
      throw new Error(updateError.message);
    }

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
