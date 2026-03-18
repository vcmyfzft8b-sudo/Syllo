import "server-only";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import { buildGeneratedContentLanguageInstruction, resolveNoteLanguageLabel } from "@/lib/languages";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";

export function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function buildNoteTargets(sourceWordCount: number, chunkCount: number) {
  return {
    targetNoteWordCount: Math.max(700, Math.min(3200, Math.round(sourceWordCount * 0.42))),
    minSectionCount: Math.max(4, Math.min(12, chunkCount)),
    recommendedTopicCount: Math.max(6, Math.min(14, Math.ceil(chunkCount / 1.5))),
  };
}

export async function generateNotesFromTranscript(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
  },
): Promise<NoteGenerationResult> {
  const windows = buildTranscriptWindows(segments, 3200);
  const sourceWordCount = segments.reduce((total, segment) => total + countWords(segment.text), 0);
  const targets = buildNoteTargets(sourceWordCount, windows.length);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);

  const chunkOutputs = await Promise.all(
    windows.map((window, index) =>
      generateStructuredObject({
        schema: chunkSummarySchema,
        schemaName: "chunk_summary",
        maxOutputTokens: 1400,
        instructions: `${languageInstruction} You create detailed study notes from lecture-style source material. Capture all substantive material from the chunk, including definitions, mechanisms, sequences, comparisons, caveats, examples already present in the source, and exam-relevant details. Never invent facts. Bullet points must be complete study points, not fragments.`,
        input: `Source chunk ${index + 1} of ${windows.length}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
      }),
    ),
  );

  const result = await generateStructuredObject({
    schema: noteArtifactSchema,
    schemaName: "note_artifact",
    maxOutputTokens: 7000,
    instructions: `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and detailed student-ready notes that cover nearly all meaningful material in the source. Do not compress the lecture into a short outline. Organize the markdown with headings, subheadings, bullet lists, and short explanatory paragraphs. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when supported by the source material. Every chunk summary should contribute substantive content to the final notes. Aim for about ${targets.targetNoteWordCount} words when the source supports it. Build at least ${targets.minSectionCount} substantial sections when the material supports it.`,
    input: JSON.stringify(
      {
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

  const noteWordCount = countWords(result.structuredNotesMd);

  return {
    ...result,
    modelMetadata: {
      chunkCount: chunkOutputs.length,
      sourceWordCount,
      noteWordCount,
      coverageRatio:
        sourceWordCount > 0 ? Number((noteWordCount / sourceWordCount).toFixed(3)) : null,
      targetNoteWordCount: targets.targetNoteWordCount,
      recommendedTopicCount: targets.recommendedTopicCount,
      pipeline: params.pipelineName,
    },
  };
}
