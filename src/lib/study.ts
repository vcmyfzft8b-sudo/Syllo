import "server-only";

import { createFlashcardDeckSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import type {
  Citation,
  FlashcardDifficulty,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { buildTranscriptWindows } from "@/lib/chunking";
import { countWords } from "@/lib/note-generation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown flashcard generation error.";
}

async function setStudyAssetStatus(params: {
  lectureId: string;
  status: LectureStudyAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();

  const payload = {
    lecture_id: params.lectureId,
    status: params.status,
    error_message: params.errorMessage ?? null,
    model_metadata: params.modelMetadata ?? {},
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("lecture_study_assets")
    .upsert(payload as never, { onConflict: "lecture_id" });

  if (error) {
    throw error;
  }
}

function buildFlashcardPromptContext(params: {
  lectureId: string;
  title: string | null;
  artifact: LectureArtifactRow;
  transcript: TranscriptSegmentRow[];
}) {
  const windows = buildTranscriptWindows(
    params.transcript.map((segment) => ({
      idx: segment.idx,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      speakerLabel: segment.speaker_label,
      text: segment.text,
    })),
    3200,
  ).map((window, index) => ({
    idx: index,
    startMs: window.startMs,
    endMs: window.endMs,
    text: window.text,
  }));

  return {
    title: params.title,
    lectureId: params.lectureId,
    summary: params.artifact.summary,
    keyTopics: params.artifact.key_topics,
    transcriptWindows: windows,
    sourceWordCount: params.transcript.reduce((total, segment) => total + countWords(segment.text), 0),
  };
}

function calculateWindowFlashcardCount(windowText: string) {
  return Math.max(2, Math.ceil(countWords(windowText) / 80));
}

async function generateFlashcardsForWindow(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  window: {
    idx: number;
    startMs: number;
    endMs: number;
    text: string;
  };
  contextWindows: Array<{
    idx: number;
    startMs: number;
    endMs: number;
    text: string;
  }>;
}) {
  const targetCount = calculateWindowFlashcardCount(params.window.text);

  const batch = await generateStructuredObject({
    schema: createFlashcardDeckSchema(targetCount),
    schemaName: `flashcard_batch_${params.window.idx}`,
    maxOutputTokens: Math.max(1800, targetCount * 420),
    instructions:
      `Create exactly ${targetCount} high-quality study flashcards for the primary transcript window. Cover all important material in that window, not just the headline topic, so the full lecture is covered batch by batch. Use neighboring windows only as supporting context when needed, but keep the main focus on the primary window. Optimize for college exam preparation with definitions, mechanisms, comparisons, processes, cause-effect relationships, examples from the source, and precise recall. Avoid duplicates, filler, and trivia. Keep the front short, ideally under 12 words. Keep the back short and direct: one sentence or two short sentences, not an essay. Every flashcard must cite 1 or 2 transcript windows from the provided context. The hint field is required: return a short hint string when useful, otherwise return null.`,
    input: JSON.stringify(
      {
        title: params.title,
        summary: params.summary,
        keyTopics: params.keyTopics,
        primaryWindow: params.window,
        contextWindows: params.contextWindows,
      },
      null,
      2,
    ),
  });

  return batch.flashcards;
}

export async function generateLectureFlashcards(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();

  await setStudyAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
  });

  try {
    const [{ data: lecture, error: lectureError }, { data: artifact, error: artifactError }, { data: transcript, error: transcriptError }] =
      await Promise.all([
        supabase
          .from("lectures")
          .select("*")
          .eq("id", params.lectureId)
          .single(),
        supabase
          .from("lecture_artifacts")
          .select("*")
          .eq("lecture_id", params.lectureId)
          .single(),
        supabase
          .from("transcript_segments")
          .select("*")
          .eq("lecture_id", params.lectureId)
          .order("idx", { ascending: true }),
      ]);

    if (lectureError) {
      throw lectureError;
    }

    if (artifactError) {
      throw artifactError;
    }

    if (transcriptError) {
      throw transcriptError;
    }

    const lectureRow = lecture as LectureRow;
    const artifactRow = artifact as LectureArtifactRow;
    const transcriptRows = (transcript ?? []) as TranscriptSegmentRow[];

    if (lectureRow.status !== "ready") {
      throw new Error("Flashcards are available after note processing finishes.");
    }

    if (transcriptRows.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const promptContext = buildFlashcardPromptContext({
      lectureId: params.lectureId,
      title: lectureRow.title,
      artifact: artifactRow,
      transcript: transcriptRows,
    });
    const generatedFlashcards = (
      await Promise.all(
        promptContext.transcriptWindows.map((window, index) =>
          generateFlashcardsForWindow({
            title: lectureRow.title,
            summary: artifactRow.summary,
            keyTopics: artifactRow.key_topics,
            window,
            contextWindows: promptContext.transcriptWindows.slice(
              Math.max(0, index - 1),
              Math.min(promptContext.transcriptWindows.length, index + 2),
            ),
          }),
        ),
      )
    ).flat();

    const difficultyCounts = generatedFlashcards.reduce<Record<FlashcardDifficulty, number>>(
      (counts, flashcard) => {
        counts[flashcard.difficulty] += 1;
        return counts;
      },
      {
        easy: 0,
        medium: 0,
        hard: 0,
      },
    );

    const flashcardsToInsert = generatedFlashcards.map((flashcard, index) => ({
      lecture_id: params.lectureId,
      idx: index,
      front: flashcard.front,
      back: flashcard.back,
      hint: flashcard.hint?.trim() ? flashcard.hint.trim() : null,
      citations_json: flashcard.citations as unknown as Citation[],
      difficulty: flashcard.difficulty,
    }));

    const { error: deleteError } = await supabase
      .from("flashcards")
      .delete()
      .eq("lecture_id", params.lectureId);

    if (deleteError) {
      throw deleteError;
    }

    const { error: insertError } = await supabase
      .from("flashcards")
      .insert(flashcardsToInsert as never);

    if (insertError) {
      throw insertError;
    }

    const noteWordCount = countWords(artifactRow.structured_notes_md);
    const sourceWordCount = promptContext.sourceWordCount;

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "ready",
      modelMetadata: {
        cardCount: generatedFlashcards.length,
        transcriptWindowCount: promptContext.transcriptWindows.length,
        perWindowTargets: promptContext.transcriptWindows.map((window) => ({
          idx: window.idx,
          cardCount: calculateWindowFlashcardCount(window.text),
        })),
        sourceWordCount,
        noteWordCount,
        coverageRatio:
          sourceWordCount > 0 ? Number((noteWordCount / sourceWordCount).toFixed(3)) : null,
        difficultyCounts,
        pipeline: "flashcards-v2",
      },
    });
  } catch (error) {
    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: {
        pipeline: "flashcards-v2",
      },
    });

    throw error;
  }
}
