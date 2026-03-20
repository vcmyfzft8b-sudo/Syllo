import "server-only";

import { z } from "zod";

import type { FlashcardDifficulty, LectureArtifactRow, LectureQuizAssetRow, LectureRow } from "@/lib/database.types";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import { countWords } from "@/lib/note-generation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const quizQuestionSchema = z.object({
  prompt: z.string().min(12).max(220),
  options: z.array(z.string().min(2).max(180)).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(20).max(260),
  difficulty: z.enum(["easy", "medium", "hard"]),
  sourceLocator: z.string().min(2).max(120).nullable(),
});

function createQuizDeckSchema(questionCount: number) {
  return z.object({
    questions: z.array(quizQuestionSchema).length(questionCount),
  });
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as PostgrestLikeError;
    const parts = [candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown quiz generation error.";
}

type QuizStorageMode = "tables" | "artifact_metadata";

type QuizStorageCapabilities = {
  mode: QuizStorageMode;
};

function getSchemaErrorText(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const candidate = error as PostgrestLikeError;
  return [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function isMissingQuizSchemaError(error: unknown) {
  const text = getSchemaErrorText(error);

  if (!text) {
    return false;
  }

  return (
    (text.includes("lecture_quiz_assets") || text.includes("quiz_questions")) &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("42p01") ||
      text.includes("42703") ||
      text.includes("pgrst"))
  );
}

function toMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return { ...(value as Record<string, unknown>) };
}

async function detectQuizStorageCapabilities(): Promise<QuizStorageCapabilities> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ error: assetError }, { error: questionsError }] = await Promise.all([
    supabase.from("lecture_quiz_assets").select("lecture_id").limit(1),
    supabase.from("quiz_questions").select("id").limit(1),
  ]);

  if (
    (assetError && !isMissingQuizSchemaError(assetError)) ||
    (questionsError && !isMissingQuizSchemaError(questionsError))
  ) {
    throw assetError ?? questionsError;
  }

  return {
    mode: assetError || questionsError ? "artifact_metadata" : "tables",
  };
}

async function updateArtifactQuizState(params: {
  lectureId: string;
  status: LectureQuizAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
  questions?: Array<{
    id: string;
    idx: number;
    prompt: string;
    options: string[];
    correct_option_idx: number;
    explanation: string;
    difficulty: FlashcardDifficulty;
    source_locator: string | null;
    created_at: string;
  }>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: artifact, error: artifactError } = await supabase
    .from("lecture_artifacts")
    .select("model_metadata")
    .eq("lecture_id", params.lectureId)
    .single();

  if (artifactError) {
    throw artifactError;
  }

  const artifactRow = artifact as { model_metadata?: unknown } | null;
  const currentMetadata = toMetadataRecord(artifactRow?.model_metadata);
  const currentQuizAsset = toMetadataRecord(currentMetadata.quizAsset);
  const now = new Date().toISOString();

  const nextMetadata = {
    ...currentMetadata,
    quizAsset: {
      lecture_id: params.lectureId,
      status: params.status,
      error_message: params.errorMessage ?? null,
      model_metadata: params.modelMetadata ?? {},
      generated_at:
        typeof currentQuizAsset.generated_at === "string"
          ? currentQuizAsset.generated_at
          : now,
      updated_at: now,
    },
    ...(params.questions
      ? {
          quizQuestions: params.questions,
        }
      : {}),
  };

  const { error: updateError } = await supabase
    .from("lecture_artifacts")
    .update(
      {
        model_metadata: nextMetadata,
      } as never,
    )
    .eq("lecture_id", params.lectureId);

  if (updateError) {
    throw updateError;
  }
}

async function setQuizAssetStatus(params: {
  lectureId: string;
  status: LectureQuizAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
  storage: QuizStorageCapabilities;
}) {
  if (params.storage.mode === "artifact_metadata") {
    await updateArtifactQuizState({
      lectureId: params.lectureId,
      status: params.status,
      errorMessage: params.errorMessage,
      modelMetadata: params.modelMetadata,
    });
    return;
  }

  const supabase = createSupabaseServiceRoleClient();
  const payload = {
    lecture_id: params.lectureId,
    status: params.status,
    error_message: params.errorMessage ?? null,
    model_metadata: params.modelMetadata ?? {},
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("lecture_quiz_assets")
    .upsert(payload as never, { onConflict: "lecture_id" });

  if (error) {
    throw error;
  }
}

export async function queueLectureQuizGeneration(lectureId: string) {
  const storage = await detectQuizStorageCapabilities();

  await setQuizAssetStatus({
    lectureId,
    status: "queued",
    errorMessage: null,
    modelMetadata: {},
    storage,
  });
}

function buildQuizQuestionCount(noteWordCount: number) {
  return Math.max(6, Math.min(12, Math.round(noteWordCount / 220)));
}

export async function generateLectureQuiz(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();
  const storage = await detectQuizStorageCapabilities();

  await setQuizAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
    modelMetadata: {
      stage: "generating_questions",
      pipeline: "quiz-v1",
    },
    storage,
  });

  try {
    const [{ data: lecture, error: lectureError }, { data: artifact, error: artifactError }] =
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
      ]);

    if (lectureError) {
      throw lectureError;
    }

    if (artifactError) {
      throw artifactError;
    }

    const lectureRow = lecture as LectureRow;
    const artifactRow = artifact as LectureArtifactRow;

    if (lectureRow.status !== "ready") {
      throw new Error("Quizzes are available after note processing finishes.");
    }

    const noteWordCount = countWords(artifactRow.structured_notes_md);
    const questionCount = buildQuizQuestionCount(noteWordCount);
    const languageInstruction = buildGeneratedContentLanguageInstruction(
      lectureRow.language_hint,
    );

    const quizDeck = await generateStructuredObject({
      schema: createQuizDeckSchema(questionCount),
      schemaName: "quiz_deck",
      maxOutputTokens: questionCount * 540,
      instructions: `${languageInstruction} Create a concise multiple-choice quiz from the supplied lecture notes. Every question must have exactly 4 answer options and exactly 1 correct answer. Keep questions direct, testable, and student-friendly. Spread questions across the material instead of clustering on one topic. Do not invent facts, examples, or terminology that are not supported by the notes. Use short but clear answer options. Explanations should briefly explain why the correct answer is right. Keep the quiz language aligned with the notes language.`,
      input: JSON.stringify(
        {
          title: lectureRow.title,
          summary: artifactRow.summary,
          keyTopics: artifactRow.key_topics,
          structuredNotesMd: artifactRow.structured_notes_md,
          targetQuestionCount: questionCount,
        },
        null,
        2,
      ),
    });

    await setQuizAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "publishing_quiz",
        pipeline: "quiz-v1",
        targetQuestionCount: questionCount,
      },
      storage,
    });

    const questionsToInsert = quizDeck.questions.map((question, index) => {
      const createdAt = new Date().toISOString();

      return {
        id: crypto.randomUUID(),
        lecture_id: params.lectureId,
        idx: index,
        prompt: question.prompt,
        options_json: question.options,
        options: question.options,
        correct_option_idx: question.correctOptionIndex,
        explanation: question.explanation,
        difficulty: question.difficulty as FlashcardDifficulty,
        source_locator: question.sourceLocator,
        created_at: createdAt,
      };
    });

    if (storage.mode === "tables") {
      const { error: deleteQuestionsError } = await supabase
        .from("quiz_questions")
        .delete()
        .eq("lecture_id", params.lectureId);

      if (deleteQuestionsError) {
        throw deleteQuestionsError;
      }

      const { error: insertQuestionsError } = await supabase
        .from("quiz_questions")
        .insert(
          questionsToInsert.map((question) => ({
            lecture_id: question.lecture_id,
            idx: question.idx,
            prompt: question.prompt,
            options_json: question.options_json,
            correct_option_idx: question.correct_option_idx,
            explanation: question.explanation,
            difficulty: question.difficulty,
            source_locator: question.source_locator,
            created_at: question.created_at,
          })) as never,
        );

      if (insertQuestionsError) {
        throw insertQuestionsError;
      }
    } else {
      await updateArtifactQuizState({
        lectureId: params.lectureId,
        status: "ready",
        errorMessage: null,
        modelMetadata: {
          stage: "ready",
          pipeline: "quiz-v1",
          questionCount,
          noteWordCount,
        },
        questions: questionsToInsert.map((question) => ({
          id: question.id,
          idx: question.idx,
          prompt: question.prompt,
          options: question.options,
          correct_option_idx: question.correct_option_idx,
          explanation: question.explanation,
          difficulty: question.difficulty,
          source_locator: question.source_locator,
          created_at: question.created_at,
        })),
      });
    }

    const difficultyCounts = quizDeck.questions.reduce<Record<FlashcardDifficulty, number>>(
      (counts, question) => {
        counts[question.difficulty] += 1;
        return counts;
      },
      {
        easy: 0,
        medium: 0,
        hard: 0,
      },
    );

    await setQuizAssetStatus({
      lectureId: params.lectureId,
      status: "ready",
      modelMetadata: {
        stage: "ready",
        pipeline: "quiz-v1",
        questionCount,
        noteWordCount,
        difficultyCounts,
      },
      storage,
    });
  } catch (error) {
    console.error("Quiz generation failed", {
      lectureId: params.lectureId,
      error,
    });

    await setQuizAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: {
        pipeline: "quiz-v1",
        stage: "failed",
      },
      storage,
    });

    throw error;
  }
}
