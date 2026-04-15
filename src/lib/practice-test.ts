import "server-only";

import { z } from "zod";

import type {
  FlashcardDifficulty,
  LectureArtifactRow,
  LecturePracticeTestAssetRow,
  LectureRow,
  PracticeTestAttemptAnswerRow,
  PracticeTestAttemptRow,
  PracticeTestQuestionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { generateStructuredObject } from "@/lib/ai/json";
import { generateStructuredObjectWithGeminiFile } from "@/lib/ai/gemini";
import { TRANSCRIPT_SEGMENT_CONTENT_SELECT } from "@/lib/database-selects";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { createCoveragePlan } from "@/lib/study-coverage";
import { dependsOnMissingStudyContext, isHighQualityStudyPrompt } from "@/lib/study-quality";
import type { CoverageConcept, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";
import { buildSourceUnits } from "@/lib/study-source-units";
import type {
  PracticeTestAttemptAnswer,
  PracticeTestAttemptWithAnswers,
  PracticeTestHistoryEntry,
  PracticeTestHistorySummary,
} from "@/lib/types";
import { getAiProvider, getServerEnv } from "@/lib/server-env";

const PRACTICE_TEST_CONCURRENCY = 3;
const RECENT_ATTEMPT_MEMORY = 3;
const PRACTICE_TEST_GENERATION_VERSION = "practice-test-v2";
const PRACTICE_TEST_GENERATION_ATTEMPTS = 3;

type PracticeTestQuestionDraft = {
  prompt: string;
  answerGuide: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
};

type AttemptQuestionMetadata = {
  questionIds: string[];
  attemptNumber: number;
  bankVersion: string;
  generationVersion: string;
};

const practiceQuestionSchema = z.object({
  prompt: z.string().min(12).max(420),
  answerGuide: z.string().min(30).max(1200),
  difficulty: z.string().min(3).max(40),
  conceptKey: z.string().min(1).max(120),
});

const practiceQuestionBatchSchema = z.object({
  questions: z.array(practiceQuestionSchema).min(0).max(16),
});

const gradingSchema = z.object({
  score: z.number().int().min(0).max(5),
  expectedAnswer: z.string().min(1).max(1400),
  rationale: z.string().min(1).max(1000),
  strengths: z.string().min(1).max(1000),
  missingPoints: z.string().min(1).max(1000),
  confidence: z.string().min(2).max(40),
});

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown practice test error.";
}

export function describePracticeTestError(error: unknown) {
  return toErrorMessage(error);
}

function toMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeDifficulty(value: string): FlashcardDifficulty {
  const normalized = value.trim().toLowerCase();

  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }

  if (normalized === "simple" || normalized === "basic") {
    return "easy";
  }

  if (normalized === "advanced" || normalized === "challenging") {
    return "hard";
  }

  return "medium";
}

function normalizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim();
}

function dedupeQuestions(questions: PracticeTestQuestionDraft[]) {
  const seen = new Set<string>();
  const output: PracticeTestQuestionDraft[] = [];

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

async function setPracticeTestAssetStatus(params: {
  lectureId: string;
  status: LecturePracticeTestAssetRow["status"];
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
    .from("lecture_practice_test_assets")
    .upsert(payload as never, { onConflict: "lecture_id" });

  if (error) {
    throw error;
  }
}

export async function queueLecturePracticeTestGeneration(lectureId: string) {
  await setPracticeTestAssetStatus({
    lectureId,
    status: "queued",
    errorMessage: null,
    modelMetadata: {},
  });
}

function targetQuestionCount(bankSize: number) {
  if (bankSize <= 8) {
    return 5;
  }
  if (bankSize <= 15) {
    return 8;
  }
  if (bankSize <= 24) {
    return 10;
  }
  if (bankSize <= 34) {
    return 12;
  }
  return 15;
}

function parseAttemptQuestionMetadata(value: unknown): AttemptQuestionMetadata | null {
  const record = toMetadataRecord(value);
  const questionIds = Array.isArray(record.questionIds)
    ? record.questionIds.filter((item): item is string => typeof item === "string")
    : [];
  const attemptNumber =
    typeof record.attemptNumber === "number" && Number.isInteger(record.attemptNumber)
      ? record.attemptNumber
      : null;
  const bankVersion = typeof record.bankVersion === "string" ? record.bankVersion : null;
  const generationVersion =
    typeof record.generationVersion === "string"
      ? record.generationVersion
      : PRACTICE_TEST_GENERATION_VERSION;

  if (!attemptNumber || !bankVersion) {
    return null;
  }

  return {
    questionIds,
    attemptNumber,
    bankVersion,
    generationVersion,
  };
}

function shuffle<T>(values: T[]) {
  const output = [...values];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const currentValue = output[index];
    output[index] = output[swapIndex] as T;
    output[swapIndex] = currentValue as T;
  }

  return output;
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
  const targetCount = Math.min(
    Math.max(
      params.concepts.reduce(
        (total, concept) => total + Math.min(Math.max(concept.recommendedCardCount, 1), 2),
        0,
      ),
      1,
    ),
    8,
  );
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const requestedConceptKeys = new Set(params.concepts.map((concept) => concept.conceptKey));
  let generatedQuestions: PracticeTestQuestionDraft[] = [];

  for (
    let attemptIndex = 0;
    attemptIndex < PRACTICE_TEST_GENERATION_ATTEMPTS &&
    (attemptIndex === 0 || (targetCount > 0 && generatedQuestions.length === 0));
    attemptIndex += 1
  ) {
    const retryInstruction =
      attemptIndex === 0
        ? ""
        : "\nPrevious output included prompts that depended on missing context. Regenerate only standalone prompts with all needed context inside the question itself.";
    const batch = await generateStructuredObject({
      schema: practiceQuestionBatchSchema,
      maxOutputTokens: Math.max(2200, targetCount * 600),
      instructions: `${languageInstruction}
${params.repairOnly ? "Repair missing practice-test coverage." : "Generate source-grounded open-ended practice-test questions."}
Use only the supplied source material.
Return at most ${targetCount} questions for this unit. The requested count is a maximum, not a quota.
Each question must be free-response and must feel like a realistic written school test prompt.
Do not use multiple-choice options.
Spread questions across the requested concepts when high-quality prompts are supported, and avoid duplicates.
Prefer prompts that require recall, explanation, listing, comparison, process description, or short synthesis grounded in the source.
Keep prompts specific and answerable from the source material.
Each question must test exactly one fact, definition, mechanism, comparison, sequence, formula, category, or cause-effect relationship.
Every question must be fully self-contained so a student can solve it without seeing the original lecture, notes, table, diagram, or example.
Do not refer to "the lecture", "the notes", "the table above", "the example shown", or any missing context outside the prompt itself.
If a question depends on source-specific data, definitions, categories, scenarios, or examples, include that context directly in the prompt.
Do not mention the source, material, lecture, notes, illustration, figure, table, graph, diagram, or example in the wording of the question.
Write prompts as direct knowledge questions that can be answered from memory after studying the topic.${retryInstruction}
Provide a concise but complete answerGuide that a grader can use for partial credit. Include the exact expected answer and 2-4 key points when the answer has multiple parts.
Skip a requested concept if the only possible prompt would be vague, source-dependent, visual-only, caption-like, or created only to fill the count.
Use the provided conceptKey exactly.
Do not invent facts beyond the source.
Return fewer than ${targetCount} questions, or zero questions, when fewer high-quality questions are supported.`,
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

    generatedQuestions = dedupeQuestions([
      ...generatedQuestions,
      ...batch.questions
        .filter((question) => requestedConceptKeys.has(question.conceptKey))
        .map((question) => ({
          prompt: normalizeText(question.prompt, 220),
          answerGuide: normalizeText(question.answerGuide, 1000),
          difficulty: normalizeDifficulty(question.difficulty),
          conceptKey: question.conceptKey,
          sourceUnitIdx: params.unit.unitIndex,
          sourceLocator: params.unit.locatorLabel,
        }))
        .filter((question) => isHighQualityStudyPrompt(question.prompt)),
    ]);
  }

  return generatedQuestions;
}

function findMissingConcepts(params: {
  plans: CoverageUnitPlan[];
  questions: PracticeTestQuestionDraft[];
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
    const missingConcepts = plan.concepts.filter(
      (concept) => (questionCountsByConcept.get(concept.conceptKey) ?? 0) < 1,
    );

    if (missingConcepts.length > 0) {
      missingConceptsByUnit.set(plan.unitIndex, missingConcepts);
    }
  }

  return missingConceptsByUnit;
}

async function generatePracticeQuestionBank(params: {
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
    await mapWithConcurrency(units, PRACTICE_TEST_CONCURRENCY, async (unit, index) => {
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
        PRACTICE_TEST_CONCURRENCY,
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

    generatedQuestions = dedupeQuestions([...generatedQuestions, ...repairedQuestions]);
  }

  const targetBankSize = Math.max(
    18,
    Math.min(
      40,
      plannedCoverage.reduce((total, plan) => total + plan.concepts.length, 0),
    ),
  );

  const sortedQuestions = shuffle(generatedQuestions).sort((left, right) => {
    if (left.sourceUnitIdx !== right.sourceUnitIdx) {
      return left.sourceUnitIdx - right.sourceUnitIdx;
    }

    return left.prompt.localeCompare(right.prompt);
  });

  return {
    units,
    plannedCoverage,
    questions: sortedQuestions.slice(0, Math.max(5, Math.min(targetBankSize, sortedQuestions.length))),
  };
}

export async function generateLecturePracticeTest(params: {
  lectureId: string;
  regenerate?: boolean;
}) {
  const supabase = createSupabaseServiceRoleClient();

  await setPracticeTestAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
    modelMetadata: {
      stage: "generating_question_bank",
      pipeline: PRACTICE_TEST_GENERATION_VERSION,
      regenerate: Boolean(params.regenerate),
    },
  });

  try {
    const [
      { data: lecture, error: lectureError },
      { data: artifact, error: artifactError },
      { data: transcript, error: transcriptError },
    ] = await Promise.all([
      supabase.from("lectures").select("*").eq("id", params.lectureId).single(),
      supabase.from("lecture_artifacts").select("*").eq("lecture_id", params.lectureId).single(),
      supabase
        .from("transcript_segments")
        .select(TRANSCRIPT_SEGMENT_CONTENT_SELECT)
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
      throw new Error("Practice tests are available after note processing finishes.");
    }

    if (transcriptRows.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const coverage = await generatePracticeQuestionBank({
      lecture: lectureRow,
      artifact: artifactRow,
      transcript: transcriptRows,
    });
    const bankVersion = new Date().toISOString();

    const { error: deleteQuestionsError } = await supabase
      .from("practice_test_questions")
      .delete()
      .eq("lecture_id", params.lectureId);

    if (deleteQuestionsError) {
      throw deleteQuestionsError;
    }

    const questionsToInsert = coverage.questions.map((question, index) => ({
      lecture_id: params.lectureId,
      idx: index,
      prompt: question.prompt,
      answer_guide: question.answerGuide,
      difficulty: question.difficulty,
      source_locator: question.sourceLocator,
      source_unit_idx: question.sourceUnitIdx,
      concept_key: question.conceptKey,
      created_at: new Date().toISOString(),
    }));

    if (questionsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("practice_test_questions")
        .insert(questionsToInsert as never);

      if (insertError) {
        throw insertError;
      }
    }

    await setPracticeTestAssetStatus({
      lectureId: params.lectureId,
      status: "ready",
      modelMetadata: {
        stage: "ready",
        pipeline: PRACTICE_TEST_GENERATION_VERSION,
        questionCount: questionsToInsert.length,
        sourceUnitCount: coverage.units.length,
        plannedConceptCount: coverage.plannedCoverage.reduce(
          (total, plan) => total + plan.concepts.length,
          0,
        ),
        bankVersion,
      },
    });
  } catch (error) {
    await setPracticeTestAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: {
        stage: "failed",
        pipeline: PRACTICE_TEST_GENERATION_VERSION,
        regenerate: Boolean(params.regenerate),
      },
    });

    throw error;
  }
}

function getQuestionIdsFromAttempt(attempt: PracticeTestAttemptRow) {
  return parseAttemptQuestionMetadata(attempt.model_metadata)?.questionIds ?? [];
}

function getAttemptNumber(attempt: PracticeTestAttemptRow) {
  return parseAttemptQuestionMetadata(attempt.model_metadata)?.attemptNumber ?? 0;
}

function getBankVersionFromAsset(asset: LecturePracticeTestAssetRow | null) {
  if (
    asset?.model_metadata &&
    typeof asset.model_metadata === "object" &&
    !Array.isArray(asset.model_metadata) &&
    "bankVersion" in asset.model_metadata &&
    typeof asset.model_metadata.bankVersion === "string"
  ) {
    return asset.model_metadata.bankVersion;
  }

  return asset?.updated_at ?? new Date().toISOString();
}

function getAttemptsForBank(params: {
  attempts: PracticeTestAttemptRow[];
  bankVersion: string;
}) {
  return params.attempts.filter(
    (attempt) => parseAttemptQuestionMetadata(attempt.model_metadata)?.bankVersion === params.bankVersion,
  );
}

function shouldRefreshPracticeTestBank(params: {
  questions: PracticeTestQuestionRow[];
  attempts: PracticeTestAttemptRow[];
  bankVersion: string;
}) {
  if (params.questions.length === 0) {
    return true;
  }

  const desiredCount = Math.min(targetQuestionCount(params.questions.length), params.questions.length);
  const usedQuestionIds = new Set(
    getAttemptsForBank({
      attempts: params.attempts,
      bankVersion: params.bankVersion,
    }).flatMap((attempt) => getQuestionIdsFromAttempt(attempt)),
  );

  const unusedQuestionCount = params.questions.filter((question) => !usedQuestionIds.has(question.id)).length;
  return unusedQuestionCount < desiredCount;
}

function scoreQuestionForSelection(params: {
  question: PracticeTestQuestionRow;
  recentQuestionCounts: Map<string, number>;
  lifetimeQuestionCounts: Map<string, number>;
  usedSourceUnitCounts: Map<number, number>;
}) {
  const recentCount = params.recentQuestionCounts.get(params.question.id) ?? 0;
  const lifetimeCount = params.lifetimeQuestionCounts.get(params.question.id) ?? 0;
  const sourceCount =
    params.question.source_unit_idx == null
      ? 0
      : (params.usedSourceUnitCounts.get(params.question.source_unit_idx) ?? 0);

  return lifetimeCount * 1000 + recentCount * 100 + sourceCount * 10 + Math.random();
}

function setsMatch(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();

  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function selectAttemptQuestions(params: {
  questions: PracticeTestQuestionRow[];
  previousAttempts: PracticeTestAttemptRow[];
}) {
  const desiredCount = Math.min(targetQuestionCount(params.questions.length), params.questions.length);
  const recentAttempts = params.previousAttempts.slice(-RECENT_ATTEMPT_MEMORY);
  const previousQuestionIds = params.previousAttempts.length
    ? getQuestionIdsFromAttempt(params.previousAttempts[params.previousAttempts.length - 1] as PracticeTestAttemptRow)
    : [];
  const recentQuestionCounts = new Map<string, number>();
  const lifetimeQuestionCounts = new Map<string, number>();

  for (const attempt of recentAttempts) {
    for (const questionId of getQuestionIdsFromAttempt(attempt)) {
      recentQuestionCounts.set(questionId, (recentQuestionCounts.get(questionId) ?? 0) + 1);
    }
  }

  for (const attempt of params.previousAttempts) {
    for (const questionId of getQuestionIdsFromAttempt(attempt)) {
      lifetimeQuestionCounts.set(questionId, (lifetimeQuestionCounts.get(questionId) ?? 0) + 1);
    }
  }

  const selected: PracticeTestQuestionRow[] = [];
  const selectedIds = new Set<string>();
  const usedSourceUnitCounts = new Map<number, number>();

  const ordered = [...params.questions].sort((left, right) => {
    const leftScore = scoreQuestionForSelection({
      question: left,
      recentQuestionCounts,
      lifetimeQuestionCounts,
      usedSourceUnitCounts,
    });
    const rightScore = scoreQuestionForSelection({
      question: right,
      recentQuestionCounts,
      lifetimeQuestionCounts,
      usedSourceUnitCounts,
    });

    return leftScore - rightScore;
  });

  for (const question of shuffle(ordered)) {
    if (selected.length >= desiredCount) {
      break;
    }

    if (selectedIds.has(question.id)) {
      continue;
    }

    selected.push(question);
    selectedIds.add(question.id);
    if (question.source_unit_idx != null) {
      usedSourceUnitCounts.set(
        question.source_unit_idx,
        (usedSourceUnitCounts.get(question.source_unit_idx) ?? 0) + 1,
      );
    }
  }

  if (
    previousQuestionIds.length > 0 &&
    setsMatch(
      selected.map((question) => question.id),
      previousQuestionIds,
    ) &&
    params.questions.length > desiredCount
  ) {
    const replacement = params.questions.find((question) => !selectedIds.has(question.id));

    if (replacement) {
      selected[selected.length - 1] = replacement;
    }
  }

  return selected.slice(0, desiredCount);
}

export async function createPracticeTestAttempt(params: {
  lectureId: string;
  userId: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const loadAttemptInputs = async () => {
    const [
      { data: asset, error: assetError },
      { data: questions, error: questionsError },
      { data: attempts, error: attemptsError },
    ] = await Promise.all([
      supabase
        .from("lecture_practice_test_assets")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .maybeSingle(),
      supabase
        .from("practice_test_questions")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .order("idx", { ascending: true }),
      supabase
        .from("practice_test_attempts")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .eq("user_id", params.userId)
        .order("created_at", { ascending: true }),
    ]);

    if (assetError) {
      throw assetError;
    }

    if (questionsError) {
      throw questionsError;
    }

    if (attemptsError) {
      throw attemptsError;
    }

    return {
      asset: asset as LecturePracticeTestAssetRow | null,
      questions: (questions ?? []) as PracticeTestQuestionRow[],
      attempts: (attempts ?? []) as PracticeTestAttemptRow[],
    };
  };

  let { asset: assetRow, questions: questionRows, attempts: previousAttempts } =
    await loadAttemptInputs();

  const hasInvalidStoredQuestions = questionRows.some((question) =>
    dependsOnMissingStudyContext(question.prompt) || !isHighQualityStudyPrompt(question.prompt),
  );
  const assetMetadata = toMetadataRecord(assetRow?.model_metadata);
  const needsInitialBank =
    !assetRow ||
    assetRow.status !== "ready" ||
    questionRows.length === 0 ||
    hasInvalidStoredQuestions ||
    (typeof assetMetadata.pipeline === "string"
      ? assetMetadata.pipeline !== PRACTICE_TEST_GENERATION_VERSION
      : true);
  if (needsInitialBank) {
    await generateLecturePracticeTest({
      lectureId: params.lectureId,
      regenerate: Boolean(assetRow),
    });
    ({ asset: assetRow, questions: questionRows, attempts: previousAttempts } =
      await loadAttemptInputs());
  }

  if (!assetRow || assetRow.status !== "ready" || questionRows.length === 0) {
    throw new Error("A practice test could not be prepared right now.");
  }

  let bankVersion = getBankVersionFromAsset(assetRow);

  if (
    shouldRefreshPracticeTestBank({
      questions: questionRows,
      attempts: previousAttempts,
      bankVersion,
    })
  ) {
    await generateLecturePracticeTest({
      lectureId: params.lectureId,
      regenerate: true,
    });
    ({ asset: assetRow, questions: questionRows, attempts: previousAttempts } =
      await loadAttemptInputs());
    if (!assetRow || assetRow.status !== "ready" || questionRows.length === 0) {
      throw new Error("A new practice test could not be prepared right now.");
    }
    bankVersion = getBankVersionFromAsset(assetRow);
  }
  const activeAttemptIds = previousAttempts
    .filter((attempt) => attempt.status === "in_progress" || attempt.status === "submitted")
    .map((attempt) => attempt.id);

  if (activeAttemptIds.length > 0) {
    const { error: closeAttemptsError } = await supabase
      .from("practice_test_attempts")
      .update({ status: "failed" } as never)
      .in("id", activeAttemptIds);

    if (closeAttemptsError) {
      throw closeAttemptsError;
    }
  }

  const attemptsOnCurrentBank = getAttemptsForBank({
    attempts: previousAttempts,
    bankVersion,
  });
  const selectedQuestions = selectAttemptQuestions({
    questions: questionRows,
    previousAttempts: attemptsOnCurrentBank,
  });

  const attemptId = crypto.randomUUID();
  const attemptNumber = previousAttempts.length + 1;

  const metadata = {
    questionIds: selectedQuestions.map((question) => question.id),
    attemptNumber,
    bankVersion,
    generationVersion: PRACTICE_TEST_GENERATION_VERSION,
  };

  const { error: insertAttemptError } = await supabase.from("practice_test_attempts").insert(
    {
      id: attemptId,
      lecture_id: params.lectureId,
      user_id: params.userId,
      status: "in_progress",
      question_count: selectedQuestions.length,
      model_metadata: metadata,
    } as never,
  );

  if (insertAttemptError) {
    throw insertAttemptError;
  }

  const { error: insertAnswersError } = await supabase
    .from("practice_test_attempt_answers")
    .insert(
      selectedQuestions.map((question, index) => ({
        attempt_id: attemptId,
        practice_test_question_id: question.id,
        idx: index,
        question_prompt: question.prompt,
        answer_guide_snapshot: question.answer_guide,
        difficulty_snapshot: question.difficulty,
        source_locator_snapshot: question.source_locator,
      })) as never,
    );

  if (insertAnswersError) {
    throw insertAnswersError;
  }

  return {
    id: attemptId,
    attemptNumber,
    questions: selectedQuestions,
  };
}

async function gradeAnswer(params: {
  prompt: string;
  answerGuide: string;
  typedAnswer: string;
}) {
  return generateStructuredObject({
    schema: gradingSchema,
    maxOutputTokens: 1600,
    instructions: `Grade the student's free-response answer using the supplied answer guide.
Return an integer score from 0 to 5.
Scoring anchors:
- 0: blank, unknown, or fundamentally incorrect
- 1: very weak answer with only slight correctness
- 2: limited partial understanding
- 3: mostly correct but incomplete or mixed
- 4: almost fully correct with minor omissions
- 5: fully correct and complete
Do not be generous with unsupported claims.
ExpectedAnswer should describe what a strong answer needed to include.
Rationale should explain the score clearly.
Strengths should mention what the student got right.
MissingPoints should mention what was absent or incorrect.`,
    input: JSON.stringify(
      {
        prompt: params.prompt,
        answerGuide: params.answerGuide,
        studentAnswer: params.typedAnswer,
      },
      null,
      2,
    ),
  });
}

function resolveAttemptQuestion(
  answer:
    | (PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null })
    | PracticeTestAttemptAnswerRow,
): PracticeTestQuestionRow | null {
  const linkedQuestion =
    "practice_test_questions" in answer ? answer.practice_test_questions : null;

  if (linkedQuestion) {
    return linkedQuestion;
  }

  if (!answer.question_prompt || !answer.answer_guide_snapshot || !answer.difficulty_snapshot) {
    return null;
  }

  return {
    id: answer.practice_test_question_id ?? `snapshot-${answer.id}`,
    lecture_id: "",
    idx: answer.idx,
    prompt: answer.question_prompt,
    answer_guide: answer.answer_guide_snapshot,
    difficulty:
      answer.difficulty_snapshot === "easy" ||
      answer.difficulty_snapshot === "medium" ||
      answer.difficulty_snapshot === "hard"
        ? answer.difficulty_snapshot
        : "medium",
    source_locator: answer.source_locator_snapshot,
    source_unit_idx: null,
    concept_key: null,
    created_at: answer.created_at,
  };
}

export async function submitPracticeTestAttempt(params: {
  lectureId: string;
  userId: string;
  attemptId: string;
  answers: Array<{
    answerId: string;
    typedAnswer: string;
    declaredUnknown: boolean;
  }>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: attempt, error: attemptError } = await supabase
    .from("practice_test_attempts")
    .select("*")
    .eq("id", params.attemptId)
    .eq("lecture_id", params.lectureId)
    .eq("user_id", params.userId)
    .single();

  if (attemptError) {
    throw attemptError;
  }

  const attemptRow = attempt as PracticeTestAttemptRow;

  const { data: storedAnswers, error: answersError } = await supabase
    .from("practice_test_attempt_answers")
    .select("*, practice_test_questions(*)")
    .eq("attempt_id", params.attemptId)
    .order("idx", { ascending: true });

  if (answersError) {
    throw answersError;
  }

  const answerRows = (storedAnswers ?? []) as Array<
    PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
  >;

  if (answerRows.length === 0) {
    throw new Error(
      "This practice-test attempt no longer has question data. Start a new practice test.",
    );
  }

  const inputByAnswerId = new Map(params.answers.map((answer) => [answer.answerId, answer]));

  for (const answer of answerRows) {
    const input = inputByAnswerId.get(answer.id);
    const hasResponse =
      Boolean(input?.declaredUnknown) ||
      Boolean(input?.typedAnswer.trim().length);

    if (!input || !hasResponse) {
      throw new Error("Every practice-test question needs an answer or 'I don't know'.");
    }
  }

  const { error: updateInputError } = await supabase
    .from("practice_test_attempt_answers")
    .upsert(
      answerRows.map((answer) => {
        const input = inputByAnswerId.get(answer.id)!;
        return {
          id: answer.id,
          attempt_id: answer.attempt_id,
          practice_test_question_id: answer.practice_test_question_id,
          idx: answer.idx,
          typed_answer: input.typedAnswer.trim() || null,
          photo_path: null,
          photo_mime_type: null,
          declared_unknown: input.declaredUnknown,
        };
      }) as never,
      { onConflict: "id" },
    );

  if (updateInputError) {
    throw updateInputError;
  }

  await supabase
    .from("practice_test_attempts")
    .update({ status: "submitted" } as never)
    .eq("id", params.attemptId);

  try {
    const gradedAnswers = await mapWithConcurrency(
      answerRows,
      PRACTICE_TEST_CONCURRENCY,
      async (answer) => {
        const input = inputByAnswerId.get(answer.id)!;
        const question = resolveAttemptQuestion(answer);

        if (!question) {
          throw new Error("Practice-test question not found.");
        }

        if (input.declaredUnknown) {
          return {
            id: answer.id,
            attempt_id: answer.attempt_id,
            practice_test_question_id: answer.practice_test_question_id,
            idx: answer.idx,
            question_prompt: answer.question_prompt,
            answer_guide_snapshot: answer.answer_guide_snapshot,
            difficulty_snapshot: answer.difficulty_snapshot,
            source_locator_snapshot: answer.source_locator_snapshot,
            score: 0,
            expected_answer: question.answer_guide,
            grading_rationale: "Marked as 'I don't know'.",
            strengths: "No submitted answer.",
            missing_points: "A complete answer was not provided.",
            grading_confidence: "high",
          };
        }

        const graded = await gradeAnswer({
          prompt: question.prompt,
          answerGuide: question.answer_guide,
          typedAnswer: input.typedAnswer.trim(),
        });

        return {
          id: answer.id,
          attempt_id: answer.attempt_id,
          practice_test_question_id: answer.practice_test_question_id,
          idx: answer.idx,
          question_prompt: answer.question_prompt,
          answer_guide_snapshot: answer.answer_guide_snapshot,
          difficulty_snapshot: answer.difficulty_snapshot,
          source_locator_snapshot: answer.source_locator_snapshot,
          score: graded.score,
          expected_answer: graded.expectedAnswer,
          grading_rationale: graded.rationale,
          strengths: graded.strengths,
          missing_points: graded.missingPoints,
          grading_confidence: graded.confidence,
        };
      },
    );

    const totalScore = gradedAnswers.reduce((total, answer) => total + answer.score, 0);
    const maxScore = gradedAnswers.length * 5;
    const percentage = maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0;

    const { error: updateGradesError } = await supabase
      .from("practice_test_attempt_answers")
      .upsert(gradedAnswers as never, {
        onConflict: "id",
      });

    if (updateGradesError) {
      throw updateGradesError;
    }

    const { error: updateAttemptError } = await supabase
      .from("practice_test_attempts")
      .update(
        {
          status: "graded",
          total_score: totalScore,
          max_score: maxScore,
          percentage,
          graded_at: new Date().toISOString(),
          model_metadata: {
            ...toMetadataRecord(attemptRow.model_metadata),
            gradedAnswerCount: gradedAnswers.length,
          },
        } as never,
      )
      .eq("id", params.attemptId);

    if (updateAttemptError) {
      throw updateAttemptError;
    }

    return {
      totalScore,
      maxScore,
      percentage,
    };
  } catch (error) {
    await supabase
      .from("practice_test_attempts")
      .update(
        {
          status: "failed",
          model_metadata: {
            ...toMetadataRecord(attemptRow.model_metadata),
            gradingError: toErrorMessage(error),
          },
        } as never,
      )
      .eq("id", params.attemptId);

    throw error;
  }
}

export async function getPracticeTestAttemptForUser(params: {
  lectureId: string;
  attemptId: string;
  userId: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: attempt, error: attemptError } = await supabase
    .from("practice_test_attempts")
    .select("*")
    .eq("id", params.attemptId)
    .eq("lecture_id", params.lectureId)
    .eq("user_id", params.userId)
    .single();

  if (attemptError) {
    throw attemptError;
  }

  const { data: answers, error: answersError } = await supabase
    .from("practice_test_attempt_answers")
    .select("*, practice_test_questions(*)")
    .eq("attempt_id", params.attemptId)
    .order("idx", { ascending: true });

  if (answersError) {
    throw answersError;
  }

  return mapAttemptWithAnswers(
    attempt as PracticeTestAttemptRow,
    (answers ?? []) as Array<
      PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
    >,
  );
}

export async function mapAttemptWithAnswers(
  attempt: PracticeTestAttemptRow,
  answers: Array<
    PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
  >,
): Promise<PracticeTestAttemptWithAnswers> {
  const mappedAnswers: PracticeTestAttemptAnswer[] = [];

  for (const answer of answers) {
    const question = resolveAttemptQuestion(answer);
    mappedAnswers.push({
      ...answer,
      question,
    });
  }

  return {
    ...attempt,
    answers: mappedAnswers,
  };
}

export function buildPracticeTestHistorySummary(
  attempts: PracticeTestAttemptWithAnswers[],
): PracticeTestHistorySummary {
  const gradedAttempts = attempts.filter(
    (attempt) =>
      attempt.status === "graded" &&
      typeof attempt.percentage === "number" &&
      typeof attempt.total_score === "number" &&
      typeof attempt.max_score === "number",
  );

  const scoresByAttempt: PracticeTestHistoryEntry[] = gradedAttempts.map((attempt) => ({
    attemptId: attempt.id,
    attemptNumber: getAttemptNumber(attempt),
    createdAt: attempt.created_at,
    percentage: attempt.percentage ?? 0,
    totalScore: attempt.total_score ?? 0,
    maxScore: attempt.max_score ?? 0,
  }));

  if (scoresByAttempt.length === 0) {
    return {
      attemptCount: 0,
      averagePercentage: null,
      bestPercentage: null,
      lowestPercentage: null,
      latestPercentage: null,
      scoresByAttempt: [],
    };
  }

  const percentages = scoresByAttempt.map((entry) => entry.percentage);

  return {
    attemptCount: scoresByAttempt.length,
    averagePercentage:
      Number((percentages.reduce((total, value) => total + value, 0) / percentages.length).toFixed(2)),
    bestPercentage: Math.max(...percentages),
    lowestPercentage: Math.min(...percentages),
    latestPercentage: scoresByAttempt[scoresByAttempt.length - 1]?.percentage ?? null,
    scoresByAttempt,
  };
}

export async function gradePracticeTestPhotoWithGemini(params: {
  file: File;
  prompt: string;
  answerGuide: string;
}) {
  const env = getServerEnv();
  return generateStructuredObjectWithGeminiFile({
    schema: gradingSchema,
    instructions: `Grade the student's handwritten or photographed answer to the prompt.
Question: ${params.prompt}
Answer guide: ${params.answerGuide}
Use the same 0-5 integer rubric as a school practice test.`,
    file: params.file,
    model: env.GEMINI_TEXT_MODEL,
    maxOutputTokens: 1600,
  });
}

export function getPreferredPracticeTestProviderMode() {
  return getAiProvider();
}
