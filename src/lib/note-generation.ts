import "server-only";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import { buildGeneratedContentLanguageInstruction, resolveNoteLanguageLabel } from "@/lib/languages";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";

const NOTE_CHUNK_SUMMARY_CONCURRENCY = 2;

export function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlFromNotes(value: string) {
  const normalized = value.trim();

  if (!/<\/?(h[1-6]|p|ul|ol|li|strong|em|blockquote|br)\b/i.test(normalized)) {
    return normalized;
  }

  return decodeHtmlEntities(
    normalized
      .replace(/\r\n/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/h1>/gi, "\n\n")
      .replace(/<h1[^>]*>/gi, "# ")
      .replace(/<\/h2>/gi, "\n\n")
      .replace(/<h2[^>]*>/gi, "## ")
      .replace(/<\/h3>/gi, "\n\n")
      .replace(/<h3[^>]*>/gi, "### ")
      .replace(/<\/h4>/gi, "\n\n")
      .replace(/<h4[^>]*>/gi, "#### ")
      .replace(/<\/h5>/gi, "\n\n")
      .replace(/<h5[^>]*>/gi, "##### ")
      .replace(/<\/h6>/gi, "\n\n")
      .replace(/<h6[^>]*>/gi, "###### ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
      .replace(/<\/strong>/gi, "**")
      .replace(/<strong[^>]*>/gi, "**")
      .replace(/<\/em>/gi, "*")
      .replace(/<em[^>]*>/gi, "*")
      .replace(/<\/blockquote>/gi, "\n")
      .replace(/<blockquote[^>]*>/gi, "> ")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function buildNoteTargets(sourceWordCount: number, chunkCount: number) {
  return {
    targetNoteWordCount: Math.max(700, Math.min(3200, Math.round(sourceWordCount * 0.42))),
    minSectionCount: Math.max(4, Math.min(12, chunkCount)),
    recommendedTopicCount: Math.max(6, Math.min(14, Math.ceil(chunkCount / 1.5))),
  };
}

function buildAudioNoteTargets(sourceWordCount: number, chunkCount: number) {
  return {
    targetNoteWordCount: Math.max(1200, Math.min(5200, Math.round(sourceWordCount * 0.58))),
    minSectionCount: Math.max(6, Math.min(18, Math.ceil(chunkCount * 1.15))),
    recommendedTopicCount: Math.max(8, Math.min(20, Math.ceil(chunkCount / 1.2))),
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export async function generateNotesFromTranscript(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    sourceType?: "audio" | "document";
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
  },
): Promise<NoteGenerationResult> {
  const sourceType = params.sourceType ?? "audio";
  const windows = buildTranscriptWindows(segments, sourceType === "audio" ? 2200 : 3200);
  const sourceWordCount = segments.reduce((total, segment) => total + countWords(segment.text), 0);
  const targets =
    sourceType === "audio"
      ? buildAudioNoteTargets(sourceWordCount, windows.length)
      : buildNoteTargets(sourceWordCount, windows.length);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);
  const chunkInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You create detailed study notes from spoken lecture transcripts. Capture all substantive material from the chunk, including definitions, mechanisms, sequences, comparisons, examples, clarifications, caveats, and exam-relevant details. Preserve technical terms and explain abbreviated or implied ideas when the transcript supports them. Do not compress the lecture into a short recap. Never invent facts. Bullet points must be complete study points, not fragments.`
      : `${languageInstruction} You create detailed study notes from lecture-style source material. Capture all substantive material from the chunk, including definitions, mechanisms, sequences, comparisons, caveats, examples already present in the source, and exam-relevant details. Never invent facts. Bullet points must be complete study points, not fragments.`;
  const finalInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and detailed student-ready notes that cover nearly all meaningful material in the source. This is a spoken lecture transcript, so reconstruct the material into clean, structured notes without dropping substance. Include important definitions, steps, relationships, examples, clarifications, and lecturer-added context when supported by the transcript. Do not compress the lecture into a short outline. Organize the markdown with headings, subheadings, bullet lists, and short explanatory paragraphs. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when supported by the source material. Every chunk summary should contribute substantive content to the final notes. Aim for about ${targets.targetNoteWordCount} words when the source supports it. Build at least ${targets.minSectionCount} substantial sections when the material supports it.`
      : `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and detailed student-ready notes that cover nearly all meaningful material in the source. Do not compress the lecture into a short outline. Organize the markdown with headings, subheadings, bullet lists, and short explanatory paragraphs. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when supported by the source material. Every chunk summary should contribute substantive content to the final notes. Aim for about ${targets.targetNoteWordCount} words when the source supports it. Build at least ${targets.minSectionCount} substantial sections when the material supports it. Return markdown only, never HTML tags like <h1>, <p>, <ul>, or <li>.`;

  const chunkOutputs = await mapWithConcurrency(
    windows,
    NOTE_CHUNK_SUMMARY_CONCURRENCY,
    (window, index) =>
      generateStructuredObject({
        schema: chunkSummarySchema,
        maxOutputTokens: sourceType === "audio" ? 1900 : 1400,
        instructions: chunkInstructions,
        input: `Source chunk ${index + 1} of ${windows.length}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
      }),
  );

  const result = await generateStructuredObject({
    schema: noteArtifactSchema,
    maxOutputTokens: sourceType === "audio" ? 12000 : 9000,
    instructions: finalInstructions,
    input: JSON.stringify(
      {
        sourceType,
        sourceWordCount,
        chunkCount: chunkOutputs.length,
        targets,
        sourceTitleHint: params.sourceTitleHint ?? null,
        chunkSummaries: chunkOutputs,
      },
      null,
      2,
    ),
  });

  const normalizedStructuredNotesMd = stripHtmlFromNotes(result.structuredNotesMd);
  const normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  return {
    ...result,
    structuredNotesMd: normalizedStructuredNotesMd,
    modelMetadata: {
      chunkCount: chunkOutputs.length,
      sourceWordCount,
      noteWordCount: normalizedNoteWordCount,
      coverageRatio:
        sourceWordCount > 0
          ? Number((normalizedNoteWordCount / sourceWordCount).toFixed(3))
          : null,
      targetNoteWordCount: targets.targetNoteWordCount,
      recommendedTopicCount: targets.recommendedTopicCount,
      sourceType,
      pipeline: params.pipelineName,
    },
  };
}
