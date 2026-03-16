import "server-only";

import { flashcardDeckSchema } from "@/lib/ai/schemas";
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
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const FLASHCARD_COUNT = 12;

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

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

    const generatedDeck = await generateStructuredObject({
      schema: flashcardDeckSchema,
      schemaName: "flashcard_deck",
      instructions:
        "Create exactly 12 high-quality study flashcards from the supplied lecture content. Optimize for college exam preparation, not for vague memorization. Cover different concept types across the lecture, including definitions, mechanisms, comparisons, processes, and cause-effect relationships when the source supports them. Avoid duplicate cards, filler phrasing, and trivia. Keep the front concise and the back direct but information-rich. Use only the supplied context. Every flashcard must cite 1 or 2 relevant transcript windows from the provided context. The hint field is required: return a short hint string when useful, otherwise return null.",
      input: JSON.stringify(promptContext, null, 2),
    });

    const difficultyCounts = generatedDeck.flashcards.reduce<Record<FlashcardDifficulty, number>>(
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

    const flashcardsToInsert = generatedDeck.flashcards.map((flashcard, index) => ({
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
        cardCount: FLASHCARD_COUNT,
        sourceWordCount,
        noteWordCount,
        coverageRatio:
          sourceWordCount > 0 ? Number((noteWordCount / sourceWordCount).toFixed(3)) : null,
        difficultyCounts,
        pipeline: "flashcards-v1",
      },
    });
  } catch (error) {
    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: {
        pipeline: "flashcards-v1",
      },
    });

    throw error;
  }
}
