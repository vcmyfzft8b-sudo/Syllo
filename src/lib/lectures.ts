import "server-only";

import type { User } from "@supabase/supabase-js";

import type {
  ChatMessageRow,
  Citation,
  FlashcardRow,
  FlashcardProgressRow,
  LectureQuizAssetRow,
  LecturePracticeTestAssetRow,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySectionRow,
  PracticeTestAttemptAnswerRow,
  PracticeTestAttemptRow,
  PracticeTestQuestionRow,
  QuizQuestionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import type {
  AppLectureListItem,
  ChatMessageWithCitations,
  FlashcardWithCitations,
  LectureDetail,
  PersistedFlashcardSessionResult,
  PersistedFlashcardSessionState,
  PersistedPracticeTestSessionState,
  PersistedQuizSessionState,
  QuizQuestionWithOptions,
  PracticeTestAttemptWithAnswers,
  PracticeTestQuestion,
  StudySectionWithProgress,
  StudySession,
} from "@/lib/types";
import { TRANSCRIPT_SEGMENT_CONTENT_SELECT } from "@/lib/database-selects";
import { buildPracticeTestHistorySummary, mapAttemptWithAnswers } from "@/lib/practice-test";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const BATCHED_IN_QUERY_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScanImportLecture(lecture: LectureRow) {
  const metadata = lecture.processing_metadata;

  if (!isRecord(metadata)) {
    return false;
  }

  const manualImport = metadata.manualImport;

  if (!isRecord(manualImport)) {
    return false;
  }

  const modelMetadata = manualImport.modelMetadata;

  return isRecord(modelMetadata) && modelMetadata.importMode === "scan";
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

function isMissingStudySectionsSchemaError(error: unknown) {
  const text = getSchemaErrorText(error);

  if (!text) {
    return false;
  }

  return (
    text.includes("lecture_study_sections") &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("42p01") ||
      text.includes("pgrst"))
  );
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
      text.includes("pgrst"))
  );
}

function isMissingStudySessionSchemaError(error: unknown) {
  const text = getSchemaErrorText(error);

  if (!text) {
    return false;
  }

  return (
    text.includes("lecture_study_sessions") &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("42p01") ||
      text.includes("pgrst"))
  );
}

function isMissingPracticeTestSchemaError(error: unknown) {
  const text = getSchemaErrorText(error);

  if (!text) {
    return false;
  }

  return (
    (text.includes("lecture_practice_test_assets") ||
      text.includes("practice_test_questions") ||
      text.includes("practice_test_attempts") ||
      text.includes("practice_test_attempt_answers")) &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("42p01") ||
      text.includes("42703") ||
      text.includes("pgrst"))
  );
}

function parseCitations(value: ChatMessageRow["citations_json"]): Citation[] {
  return Array.isArray(value) ? (value as unknown as Citation[]) : [];
}

function mapChatMessage(message: ChatMessageRow): ChatMessageWithCitations {
  return {
    ...message,
    citations: parseCitations(message.citations_json),
  };
}

function mapFlashcard(flashcard: FlashcardRow): FlashcardWithCitations {
  return {
    ...flashcard,
    citations: parseCitations(flashcard.citations_json),
    progress: null,
  };
}

function parseQuizOptions(value: QuizQuestionRow["options_json"]): string[] {
  return Array.isArray(value)
    ? value.filter((option): option is string => typeof option === "string")
    : [];
}

function parseJsonRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function toPositiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function toNonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function parseFlashcardSessionResults(value: unknown): Record<string, PersistedFlashcardSessionResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const results: Record<string, PersistedFlashcardSessionResult> = {};

  for (const [flashcardId, candidate] of Object.entries(value)) {
    const record = parseJsonRecord(candidate);
    const firstConfidence =
      record.firstConfidence === "again" ||
      record.firstConfidence === "good" ||
      record.firstConfidence === "easy"
        ? record.firstConfidence
        : null;
    const latestConfidence =
      record.latestConfidence === "again" ||
      record.latestConfidence === "good" ||
      record.latestConfidence === "easy"
        ? record.latestConfidence
        : null;

    if (!firstConfidence || !latestConfidence) {
      continue;
    }

    results[flashcardId] = {
      attempts: toPositiveInteger(record.attempts, 1),
      firstConfidence,
      latestConfidence,
    };
  }

  return results;
}

function parseFlashcardSessionState(value: unknown): PersistedFlashcardSessionState | null {
  const record = parseJsonRecord(value);

  if (Object.keys(record).length === 0) {
    return null;
  }

  const roundSummaryRecord = parseJsonRecord(record.roundSummary);

  return {
    reviewQueue: Array.isArray(record.reviewQueue)
      ? record.reviewQueue.filter((item): item is string => typeof item === "string")
      : [],
    repeatQueue: Array.isArray(record.repeatQueue)
      ? record.repeatQueue.filter((item): item is string => typeof item === "string")
      : [],
    reviewCycle: toPositiveInteger(record.reviewCycle, 1),
    cycleCardCount: toNonNegativeInteger(record.cycleCardCount, 0),
    roundSummary:
      Object.keys(roundSummaryRecord).length > 0
        ? {
            cycle: toPositiveInteger(roundSummaryRecord.cycle, 1),
            total: toNonNegativeInteger(roundSummaryRecord.total, 0),
            known: toNonNegativeInteger(roundSummaryRecord.known, 0),
            missed: toNonNegativeInteger(roundSummaryRecord.missed, 0),
          }
        : null,
    sessionResults: parseFlashcardSessionResults(record.sessionResults),
  };
}

function parseQuizSessionState(value: unknown): PersistedQuizSessionState | null {
  const record = parseJsonRecord(value);

  if (Object.keys(record).length === 0) {
    return null;
  }

  const roundSummaryRecord = parseJsonRecord(record.roundSummary);
  const optionOrdersRecord = parseJsonRecord(record.optionOrders);
  const selectionsRecord = parseJsonRecord(record.selections);
  const optionOrders: Record<string, number[]> = {};
  const selections: Record<string, number> = {};

  for (const [questionId, candidate] of Object.entries(optionOrdersRecord)) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    optionOrders[questionId] = candidate.filter(
      (index): index is number => typeof index === "number" && Number.isInteger(index) && index >= 0,
    );
  }

  for (const [questionId, candidate] of Object.entries(selectionsRecord)) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) {
      selections[questionId] = candidate;
    }
  }

  return {
    quizQueue: Array.isArray(record.quizQueue)
      ? record.quizQueue.filter((item): item is string => typeof item === "string")
      : [],
    quizRound: toPositiveInteger(record.quizRound, 1),
    quizRoundCount: toNonNegativeInteger(record.quizRoundCount, 0),
    roundSummary:
      Object.keys(roundSummaryRecord).length > 0
        ? {
            cycle: toPositiveInteger(roundSummaryRecord.cycle, 1),
            total: toNonNegativeInteger(roundSummaryRecord.total, 0),
            correct: toNonNegativeInteger(roundSummaryRecord.correct, 0),
            missed: toNonNegativeInteger(roundSummaryRecord.missed, 0),
            missedQuestionIds: Array.isArray(roundSummaryRecord.missedQuestionIds)
              ? roundSummaryRecord.missedQuestionIds.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
          }
        : null,
    activeQuestionIndex: toNonNegativeInteger(record.activeQuestionIndex, 0),
    selections,
    optionOrders,
  };
}

function parsePracticeTestSessionState(value: unknown): PersistedPracticeTestSessionState | null {
  const record = parseJsonRecord(value);

  if (Object.keys(record).length === 0) {
    return null;
  }

  return {
    currentAttemptId: typeof record.currentAttemptId === "string" ? record.currentAttemptId : null,
    attemptQuestionIds: Array.isArray(record.attemptQuestionIds)
      ? record.attemptQuestionIds.filter((item): item is string => typeof item === "string")
      : [],
    textAnswers: Object.fromEntries(
      Object.entries(parseJsonRecord(record.textAnswers)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    unknownQuestionIds: Array.isArray(record.unknownQuestionIds)
      ? record.unknownQuestionIds.filter((item): item is string => typeof item === "string")
      : [],
    latestViewedAttemptId:
      typeof record.latestViewedAttemptId === "string" ? record.latestViewedAttemptId : null,
    submittedAt: typeof record.submittedAt === "string" ? record.submittedAt : null,
  };
}

function parseStudySession(value: unknown): StudySession | null {
  const record = parseJsonRecord(value);

  if (
    typeof record.user_id !== "string" ||
    typeof record.lecture_id !== "string" ||
    typeof record.created_at !== "string" ||
    typeof record.updated_at !== "string" ||
    (record.active_study_view !== "flashcards" &&
      record.active_study_view !== "quiz" &&
      record.active_study_view !== "practice_test")
  ) {
    return null;
  }

  return {
    user_id: record.user_id,
    lecture_id: record.lecture_id,
    active_study_view: record.active_study_view,
    flashcard_state: parseFlashcardSessionState(record.flashcard_state),
    quiz_state: parseQuizSessionState(record.quiz_state),
    practice_test_state: parsePracticeTestSessionState(record.practice_test_state),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function mapQuizQuestion(question: QuizQuestionRow): QuizQuestionWithOptions {
  return {
    ...question,
    options: parseQuizOptions(question.options_json),
  };
}

function mapPracticeTestQuestion(question: PracticeTestQuestionRow): PracticeTestQuestion {
  return question;
}

async function fetchFlashcardProgressRows(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  flashcardIds: string[];
}) {
  if (params.flashcardIds.length === 0) {
    return [] as FlashcardProgressRow[];
  }

  const batches: string[][] = [];

  for (let index = 0; index < params.flashcardIds.length; index += BATCHED_IN_QUERY_SIZE) {
    batches.push(params.flashcardIds.slice(index, index + BATCHED_IN_QUERY_SIZE));
  }

  const progressRows: FlashcardProgressRow[] = [];

  for (const batch of batches) {
    const { data, error } = await params.supabase
      .from("flashcard_progress")
      .select("*")
      .eq("user_id", params.userId)
      .in("flashcard_id", batch);

    if (error) {
      throw error;
    }

    progressRows.push(...((data ?? []) as FlashcardProgressRow[]));
  }

  return progressRows;
}

async function fetchPracticeTestAttemptAnswers(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  attemptIds: string[];
}) {
  if (params.attemptIds.length === 0) {
    return [] as Array<
      PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
    >;
  }

  const answers: Array<
    PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
  > = [];

  for (let index = 0; index < params.attemptIds.length; index += BATCHED_IN_QUERY_SIZE) {
    const attemptIdBatch = params.attemptIds.slice(index, index + BATCHED_IN_QUERY_SIZE);
    const { data, error } = await params.supabase
      .from("practice_test_attempt_answers")
      .select("*, practice_test_questions(*)")
      .in("attempt_id", attemptIdBatch)
      .order("idx", { ascending: true });

    if (error) {
      throw error;
    }

    answers.push(
      ...((data ?? []) as Array<
        PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
      >),
    );
  }

  return answers;
}

function parseFallbackQuizState(params: {
  lectureId: string;
  metadata: unknown;
}) {
  const metadata = parseJsonRecord(params.metadata);
  const rawAsset = parseJsonRecord(metadata.quizAsset);
  const rawQuestions = Array.isArray(metadata.quizQuestions) ? metadata.quizQuestions : [];

  const assetStatus =
    rawAsset.status === "queued" ||
    rawAsset.status === "generating" ||
    rawAsset.status === "ready" ||
    rawAsset.status === "failed"
      ? (rawAsset.status as LectureQuizAssetRow["status"])
      : null;

  const quizAsset: LectureQuizAssetRow | null =
    assetStatus
      ? {
          lecture_id: params.lectureId,
          status: assetStatus,
          error_message:
            typeof rawAsset.error_message === "string" ? rawAsset.error_message : null,
          model_metadata: parseJsonRecord(rawAsset.model_metadata) as LectureQuizAssetRow["model_metadata"],
          generated_at:
            typeof rawAsset.generated_at === "string"
              ? rawAsset.generated_at
              : new Date(0).toISOString(),
          updated_at:
            typeof rawAsset.updated_at === "string"
              ? rawAsset.updated_at
              : new Date(0).toISOString(),
        }
      : null;

  const quizQuestions = rawQuestions.flatMap((item, index) => {
    const question = parseJsonRecord(item);
    const options = Array.isArray(question.options)
      ? question.options.filter((option): option is string => typeof option === "string")
      : [];
    const difficulty =
      question.difficulty === "easy" ||
      question.difficulty === "medium" ||
      question.difficulty === "hard"
        ? (question.difficulty as QuizQuestionRow["difficulty"])
        : null;
    const correctOptionIndex =
      typeof question.correct_option_idx === "number" ? question.correct_option_idx : null;

    if (
      typeof question.id !== "string" ||
      typeof question.prompt !== "string" ||
      typeof question.explanation !== "string" ||
      !difficulty ||
      correctOptionIndex == null
    ) {
      return [];
    }

    return [
      {
        id: question.id,
        lecture_id: params.lectureId,
        idx: typeof question.idx === "number" ? question.idx : index,
        prompt: question.prompt,
        options,
        correct_option_idx: correctOptionIndex,
        explanation: question.explanation,
        difficulty,
        source_locator:
          typeof question.source_locator === "string" ? question.source_locator : null,
        created_at:
          typeof question.created_at === "string"
            ? question.created_at
            : new Date(0).toISOString(),
      },
    ];
  });

  return {
    quizAsset,
    quizQuestions,
  };
}

function buildStudySections(params: {
  lectureId: string;
  flashcards: FlashcardWithCitations[];
  sections: LectureStudySectionRow[];
}): StudySectionWithProgress[] {
  if (params.sections.length === 0) {
    if (params.flashcards.length === 0) {
      return [];
    }

    const reviewedCount = params.flashcards.filter((flashcard) => (flashcard.progress?.review_count ?? 0) > 0).length;

    return [
      {
        id: `legacy-${params.lectureId}`,
        lecture_id: params.lectureId,
        idx: 0,
        title: "Study deck",
        source_label: null,
        source_start_ms: null,
        source_end_ms: null,
        source_page_start: null,
        source_page_end: null,
        unit_start_idx: 0,
        unit_end_idx: Math.max(params.flashcards.length - 1, 0),
        card_count: params.flashcards.length,
        created_at: new Date(0).toISOString(),
        reviewedCount,
        completed: reviewedCount >= params.flashcards.length,
      },
    ];
  }

  const flashcardsBySectionId = new Map<string, FlashcardWithCitations[]>();

  for (const flashcard of params.flashcards) {
    if (!flashcard.section_id) {
      continue;
    }

    const existing = flashcardsBySectionId.get(flashcard.section_id) ?? [];
    existing.push(flashcard);
    flashcardsBySectionId.set(flashcard.section_id, existing);
  }

  return params.sections.map((section) => {
    const sectionFlashcards = flashcardsBySectionId.get(section.id) ?? [];
    const reviewedCount = sectionFlashcards.filter(
      (flashcard) => (flashcard.progress?.review_count ?? 0) > 0,
    ).length;

    return {
      ...section,
      card_count: section.card_count || sectionFlashcards.length,
      reviewedCount,
      completed: sectionFlashcards.length > 0 && reviewedCount >= sectionFlashcards.length,
    };
  });
}

export async function listLecturesForUser(userId: string): Promise<AppLectureListItem[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("lectures")
    .select(
      "id, user_id, title, source_type, duration_seconds, status, language_hint, error_message, created_at, updated_at, access_tier",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as LectureRow[];
}

export async function getLectureDetailForUser(params: {
  lectureId: string;
  userId: string;
}): Promise<LectureDetail | null> {
  if (!uuidSchema.safeParse(params.lectureId).success) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const service = createSupabaseServiceRoleClient();

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("*")
    .eq("id", params.lectureId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (lectureError) {
    throw lectureError;
  }

  if (!lecture) {
    return null;
  }

  const lectureRow = lecture as LectureRow;
  const detailClient = service;

  const studySectionsPromise = detailClient
    .from("lecture_study_sections")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .order("idx", { ascending: true });
  const quizAssetPromise = detailClient
    .from("lecture_quiz_assets")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .maybeSingle();
  const studySessionPromise = detailClient
    .from("lecture_study_sessions")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .eq("user_id", params.userId)
    .maybeSingle();
  const quizQuestionsPromise = detailClient
    .from("quiz_questions")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .order("idx", { ascending: true });
  const practiceTestAssetPromise = detailClient
    .from("lecture_practice_test_assets")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .maybeSingle();
  const practiceTestQuestionsPromise = detailClient
    .from("practice_test_questions")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .order("idx", { ascending: true });
  const practiceTestAttemptsPromise = detailClient
    .from("practice_test_attempts")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: true });
  const transcriptPromise =
    lectureRow.source_type === "audio" || isScanImportLecture(lectureRow)
      ? detailClient
          .from("transcript_segments")
          .select(TRANSCRIPT_SEGMENT_CONTENT_SELECT)
          .eq("lecture_id", lectureRow.id)
          .order("idx", { ascending: true })
      : Promise.resolve({ data: [], error: null });

  const [
    { data: artifact, error: artifactError },
    { data: studyAsset, error: studyAssetError },
    { data: flashcards, error: flashcardsError },
    { data: transcript, error: transcriptError },
    { data: chatMessages, error: chatError },
    studySectionsResult,
    quizAssetResult,
    studySessionResult,
    quizQuestionsResult,
    practiceTestAssetResult,
    practiceTestQuestionsResult,
    practiceTestAttemptsResult,
  ] = await Promise.all([
    detailClient
      .from("lecture_artifacts")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .maybeSingle(),
    detailClient
      .from("lecture_study_assets")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .maybeSingle(),
    detailClient
      .from("flashcards")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .order("idx", { ascending: true }),
    transcriptPromise,
    detailClient
      .from("chat_messages")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .order("created_at", { ascending: true }),
    studySectionsPromise,
    quizAssetPromise,
    studySessionPromise,
    quizQuestionsPromise,
    practiceTestAssetPromise,
    practiceTestQuestionsPromise,
    practiceTestAttemptsPromise,
  ]);

  if (artifactError) {
    throw artifactError;
  }

  if (transcriptError) {
    throw transcriptError;
  }

  if (studyAssetError) {
    throw studyAssetError;
  }

  if (flashcardsError) {
    throw flashcardsError;
  }

  if (chatError) {
    throw chatError;
  }

  if (quizAssetResult.error && !isMissingQuizSchemaError(quizAssetResult.error)) {
    throw quizAssetResult.error;
  }

  if (quizQuestionsResult.error && !isMissingQuizSchemaError(quizQuestionsResult.error)) {
    throw quizQuestionsResult.error;
  }

  if (
    practiceTestAssetResult.error &&
    !isMissingPracticeTestSchemaError(practiceTestAssetResult.error)
  ) {
    throw practiceTestAssetResult.error;
  }

  if (
    practiceTestQuestionsResult.error &&
    !isMissingPracticeTestSchemaError(practiceTestQuestionsResult.error)
  ) {
    throw practiceTestQuestionsResult.error;
  }

  if (
    practiceTestAttemptsResult.error &&
    !isMissingPracticeTestSchemaError(practiceTestAttemptsResult.error)
  ) {
    throw practiceTestAttemptsResult.error;
  }

  if (
    studySessionResult.error &&
    !isMissingStudySessionSchemaError(studySessionResult.error)
  ) {
    throw studySessionResult.error;
  }

  const studySections =
    studySectionsResult.error && isMissingStudySectionsSchemaError(studySectionsResult.error)
      ? []
      : ((studySectionsResult.data ?? []) as LectureStudySectionRow[]);
  const fallbackQuizState = parseFallbackQuizState({
    lectureId: lectureRow.id,
    metadata: (artifact as LectureArtifactRow | null)?.model_metadata,
  });
  const quizAsset =
    (quizAssetResult.error && isMissingQuizSchemaError(quizAssetResult.error)
      ? null
      : (quizAssetResult.data as LectureQuizAssetRow | null)) ?? fallbackQuizState.quizAsset;
  const quizQuestions = (
    quizQuestionsResult.error && isMissingQuizSchemaError(quizQuestionsResult.error)
      ? []
      : ((quizQuestionsResult.data ?? []) as QuizQuestionRow[])
  ).map(mapQuizQuestion);
  const practiceTestAsset =
    practiceTestAssetResult.error && isMissingPracticeTestSchemaError(practiceTestAssetResult.error)
      ? null
      : (practiceTestAssetResult.data as LecturePracticeTestAssetRow | null);
  const practiceTestQuestions = (
    practiceTestQuestionsResult.error &&
    isMissingPracticeTestSchemaError(practiceTestQuestionsResult.error)
      ? []
      : ((practiceTestQuestionsResult.data ?? []) as PracticeTestQuestionRow[])
  ).map(mapPracticeTestQuestion);
  const practiceTestAttempts =
    practiceTestAttemptsResult.error &&
    isMissingPracticeTestSchemaError(practiceTestAttemptsResult.error)
      ? []
      : ((practiceTestAttemptsResult.data ?? []) as PracticeTestAttemptRow[]);

  if (studySectionsResult.error && !isMissingStudySectionsSchemaError(studySectionsResult.error)) {
    throw studySectionsResult.error;
  }

  const flashcardRows = (flashcards ?? []) as FlashcardRow[];
  const flashcardIds = flashcardRows.map((flashcard) => flashcard.id);
  const flashcardProgress = await fetchFlashcardProgressRows({
    supabase: detailClient,
    userId: params.userId,
    flashcardIds,
  });

  const progressByFlashcardId = new Map(
    flashcardProgress.map((progress) => [
      progress.flashcard_id,
      progress,
    ]),
  );
  const mappedFlashcards = flashcardRows.map((flashcard) => ({
    ...mapFlashcard(flashcard),
    progress: progressByFlashcardId.get(flashcard.id) ?? null,
  }));

  let audioUrl: string | null = null;
  let mappedPracticeAttempts: PracticeTestAttemptWithAnswers[] = [];

  if (lectureRow.storage_path) {
    const { data: signed } = await service.storage
      .from("lecture-audio")
      .createSignedUrl(lectureRow.storage_path, 60 * 60);

    audioUrl = signed?.signedUrl ?? null;
  }

  if (practiceTestAttempts.length > 0) {
    const attemptIds = practiceTestAttempts.map((attempt) => attempt.id);
    let attemptAnswers: Array<
      PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
    > = [];

    try {
      attemptAnswers = await fetchPracticeTestAttemptAnswers({
        supabase,
        attemptIds,
      });
    } catch (error) {
      if (!isMissingPracticeTestSchemaError(error)) {
        throw error;
      }
    }

    const answersByAttemptId = new Map<
      string,
      Array<PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }>
    >();

    for (const answer of attemptAnswers) {
      const existing = answersByAttemptId.get(answer.attempt_id) ?? [];
      existing.push(answer);
      answersByAttemptId.set(answer.attempt_id, existing);
    }

    mappedPracticeAttempts = await Promise.all(
      practiceTestAttempts.map((attempt) =>
        mapAttemptWithAnswers(attempt, answersByAttemptId.get(attempt.id) ?? []),
      ),
    );
  }

  return {
    lecture: lectureRow,
    artifact: artifact as LectureArtifactRow | null,
    studyAsset: studyAsset as LectureStudyAssetRow | null,
    quizAsset,
    practiceTestAsset,
    studySession:
      studySessionResult.error && isMissingStudySessionSchemaError(studySessionResult.error)
        ? null
        : parseStudySession(studySessionResult.data),
    studySections: buildStudySections({
      lectureId: lectureRow.id,
      flashcards: mappedFlashcards,
      sections: studySections,
    }),
    flashcards: mappedFlashcards,
    quizQuestions: quizQuestions.length > 0 ? quizQuestions : fallbackQuizState.quizQuestions,
    practiceTestQuestions,
    practiceTestAttempts: mappedPracticeAttempts,
    practiceTestHistorySummary: buildPracticeTestHistorySummary(mappedPracticeAttempts),
    transcript: (transcript ?? []) as TranscriptSegmentRow[],
    chatMessages: (chatMessages ?? []).map(mapChatMessage),
    audioUrl,
  };
}

export async function ensureUserOwnsLecture(params: {
  lectureId: string;
  user: User;
}): Promise<LectureRow | null> {
  if (!uuidSchema.safeParse(params.lectureId).success) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lectures")
    .select("*")
    .eq("id", params.lectureId)
    .eq("user_id", params.user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as LectureRow | null;
}
