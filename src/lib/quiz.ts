import "server-only";

import { z } from "zod";

import type {
  FlashcardDifficulty,
  LectureArtifactRow,
  LectureQuizAssetRow,
  LectureRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { createCoveragePlan } from "@/lib/study-coverage";
import type { CoverageConcept, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";
import { buildSourceUnits } from "@/lib/study-source-units";

const QUIZ_CONCURRENCY = 2;

type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type QuizStorageMode = "tables" | "artifact_metadata";

type QuizStorageCapabilities = {
  mode: QuizStorageMode;
};

type QuizQuestionDraft = {
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
};

const quizQuestionSchema = z.object({
  prompt: z.string().min(12).max(220),
  options: z.array(z.string().min(2).max(180)).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(20).max(260),
  difficulty: z.enum(["easy", "medium", "hard"]),
  conceptKey: z.string().min(3).max(80),
});

const quizQuestionBatchSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1).max(24),
});

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

function countTargetQuestions(concepts: CoverageConcept[]) {
  return concepts.reduce(
    (total, concept) => total + Math.min(Math.max(concept.recommendedCardCount, 1), 2),
    0,
  );
}

function dedupeQuizQuestions(questions: QuizQuestionDraft[]) {
  const seen = new Set<string>();
  const output: QuizQuestionDraft[] = [];

  for (const question of questions) {
    const key = `${question.conceptKey}::${question.prompt.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(question);
  }

  return output;
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);

  return results;
}

async function generateQuestionsForUnit(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  unit: SourceUnit;
  concepts: CoverageConcept[];
  contextUnits: SourceUnit[];
  outputLanguage?: string | null;
  repairOnly?: boolean;
}) {
  const targetCount = countTargetQuestions(params.concepts);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  const batch = await generateStructuredObject({
    schema: quizQuestionBatchSchema,
    schemaName: `quiz_questions_unit_${params.unit.unitIndex}`,
    maxOutputTokens: Math.max(2200, targetCount * 520),
    instructions: `${languageInstruction}
${params.repairOnly ? "Repair missing quiz coverage." : "Generate source-grounded multiple-choice quiz questions."}
Use only the supplied source material.
Cover every requested concept explicitly.
Return ${targetCount} total questions for this unit.
For each concept, create as many questions as its recommendedCardCount, capped at 2.
When a concept requests 2 questions, make them materially different and test different angles of understanding.
Every question must have exactly 4 answer options and exactly 1 correct answer.
Avoid "all of the above", "none of the above", trick phrasing, and ambiguous distractors.
Keep questions concise, testable, and grounded in the source.
Use the provided conceptKey exactly.
Do not invent facts, terms, or examples that are not supported by the source.`,
    input: JSON.stringify(
      {
        title: params.title,
        summary: params.summary,
        keyTopics: params.keyTopics,
        repairOnly: Boolean(params.repairOnly),
        unit: {
          unitIndex: params.unit.unitIndex,
          sectionTitle: params.unit.sectionTitle,
          locatorLabel: params.unit.locatorLabel,
          sourceType: params.unit.sourceType,
          text: params.unit.text,
        },
        concepts: params.concepts.map((concept) => ({
          ...concept,
          recommendedQuestionCount: Math.min(Math.max(concept.recommendedCardCount, 1), 2),
        })),
        contextUnits: params.contextUnits.map((unit) => ({
          unitIndex: unit.unitIndex,
          locatorLabel: unit.locatorLabel,
          text: unit.text,
        })),
      },
      null,
      2,
    ),
  });

  return dedupeQuizQuestions(
    batch.questions.map((question) => ({
      prompt: question.prompt.trim(),
      options: question.options.map((option) => option.trim()),
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation.trim(),
      difficulty: question.difficulty,
      conceptKey: question.conceptKey,
      sourceUnitIdx: params.unit.unitIndex,
      sourceLocator: params.unit.locatorLabel,
    })),
  );
}

function findMissingConcepts(params: {
  plans: CoverageUnitPlan[];
  questions: QuizQuestionDraft[];
}) {
  const questionCountsByConcept = new Map<string, number>();

  for (const question of params.questions) {
    questionCountsByConcept.set(
      question.conceptKey,
      (questionCountsByConcept.get(question.conceptKey) ?? 0) + 1,
    );
  }

  const missingConceptsByUnit = new Map<number, CoverageConcept[]>();

  for (const plan of params.plans) {
    const missingConcepts = plan.concepts.filter((concept) => {
      const targetCount = Math.min(Math.max(concept.recommendedCardCount, 1), 2);
      return (questionCountsByConcept.get(concept.conceptKey) ?? 0) < targetCount;
    });

    if (missingConcepts.length > 0) {
      missingConceptsByUnit.set(plan.unitIndex, missingConcepts);
    }
  }

  return missingConceptsByUnit;
}

async function generateCoverageQuiz(params: {
  lecture: LectureRow;
  artifact: LectureArtifactRow;
  transcript: TranscriptSegmentRow[];
}) {
  const { units } = buildSourceUnits({
    lecture: params.lecture,
    transcript: params.transcript,
  });
  const plannedCoverage = await createCoveragePlan({
    title: params.lecture.title,
    summary: params.artifact.summary,
    keyTopics: params.artifact.key_topics,
    units,
  });
  const planByUnit = new Map(plannedCoverage.map((plan) => [plan.unitIndex, plan]));

  let generatedQuestions = (
    await mapWithConcurrency(units, QUIZ_CONCURRENCY, async (unit, index) => {
      const plan = planByUnit.get(unit.unitIndex);
      if (!plan || plan.concepts.length === 0) {
        return [];
      }

      return generateQuestionsForUnit({
        title: params.lecture.title,
        summary: params.artifact.summary,
        keyTopics: params.artifact.key_topics,
        unit,
        concepts: plan.concepts,
        contextUnits: units.slice(Math.max(0, index - 1), Math.min(units.length, index + 2)),
        outputLanguage: params.lecture.language_hint,
      });
    })
  ).flat();

  const missingConceptsByUnit = findMissingConcepts({
    plans: plannedCoverage,
    questions: generatedQuestions,
  });

  if (missingConceptsByUnit.size > 0) {
    const repairedQuestions = (
      await mapWithConcurrency(
        [...missingConceptsByUnit.entries()],
        QUIZ_CONCURRENCY,
        async ([unitIndex, concepts]) => {
          const unit = units.find((candidate) => candidate.unitIndex === unitIndex);
          if (!unit) {
            return [];
          }

          return generateQuestionsForUnit({
            title: params.lecture.title,
            summary: params.artifact.summary,
            keyTopics: params.artifact.key_topics,
            unit,
            concepts,
            contextUnits: units.slice(Math.max(0, unitIndex - 1), Math.min(units.length, unitIndex + 2)),
            outputLanguage: params.lecture.language_hint,
            repairOnly: true,
          });
        },
      )
    ).flat();

    generatedQuestions = dedupeQuizQuestions([...generatedQuestions, ...repairedQuestions]);
  }

  return {
    units,
    plannedCoverage,
    questions: generatedQuestions,
  };
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
    const [
      { data: lecture, error: lectureError },
      { data: artifact, error: artifactError },
      { data: transcript, error: transcriptError },
    ] = await Promise.all([
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
      throw new Error("Quizzes are available after note processing finishes.");
    }

    if (transcriptRows.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const coverageQuiz = await generateCoverageQuiz({
      lecture: lectureRow,
      artifact: artifactRow,
      transcript: transcriptRows,
    });
    const questionCount = coverageQuiz.questions.length;

    await setQuizAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "publishing_quiz",
        pipeline: "quiz-v1",
        targetQuestionCount: questionCount,
        sourceUnitCount: coverageQuiz.units.length,
        plannedConceptCount: coverageQuiz.plannedCoverage.reduce(
          (total, plan) => total + plan.concepts.length,
          0,
        ),
      },
      storage,
    });

    const questionsToInsert = coverageQuiz.questions.map((question, index) => {
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
        difficulty: question.difficulty,
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
          sourceUnitCount: coverageQuiz.units.length,
          plannedConceptCount: coverageQuiz.plannedCoverage.reduce(
            (total, plan) => total + plan.concepts.length,
            0,
          ),
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

    const difficultyCounts = coverageQuiz.questions.reduce<Record<FlashcardDifficulty, number>>(
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
        sourceUnitCount: coverageQuiz.units.length,
        plannedConceptCount: coverageQuiz.plannedCoverage.reduce(
          (total, plan) => total + plan.concepts.length,
          0,
        ),
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
