import "server-only";

import type { User } from "@supabase/supabase-js";

import type {
  ChatMessageRow,
  Citation,
  FlashcardRow,
  FlashcardProgressRow,
  LectureQuizAssetRow,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySectionRow,
  QuizQuestionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import type {
  AppLectureListItem,
  ChatMessageWithCitations,
  FlashcardWithCitations,
  LectureDetail,
  QuizQuestionWithOptions,
  StudySectionWithProgress,
} from "@/lib/types";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
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

function mapQuizQuestion(question: QuizQuestionRow): QuizQuestionWithOptions {
  return {
    ...question,
    options: parseQuizOptions(question.options_json),
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
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lectures")
    .select("*")
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

  const studySectionsPromise = supabase
    .from("lecture_study_sections")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .order("idx", { ascending: true });
  const quizAssetPromise = supabase
    .from("lecture_quiz_assets")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .maybeSingle();
  const quizQuestionsPromise = supabase
    .from("quiz_questions")
    .select("*")
    .eq("lecture_id", lectureRow.id)
    .order("idx", { ascending: true });

  const [
    { data: artifact, error: artifactError },
    { data: studyAsset, error: studyAssetError },
    { data: flashcards, error: flashcardsError },
    { data: transcript, error: transcriptError },
    { data: chatMessages, error: chatError },
    studySectionsResult,
    quizAssetResult,
    quizQuestionsResult,
  ] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .maybeSingle(),
    supabase
      .from("lecture_study_assets")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .maybeSingle(),
    supabase
      .from("flashcards")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .order("idx", { ascending: true }),
    supabase
      .from("transcript_segments")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .order("idx", { ascending: true }),
    supabase
      .from("chat_messages")
      .select("*")
      .eq("lecture_id", lectureRow.id)
      .order("created_at", { ascending: true }),
    studySectionsPromise,
    quizAssetPromise,
    quizQuestionsPromise,
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

  const studySections =
    studySectionsResult.error && isMissingStudySectionsSchemaError(studySectionsResult.error)
      ? []
      : ((studySectionsResult.data ?? []) as LectureStudySectionRow[]);
  const quizAsset =
    quizAssetResult.error && isMissingQuizSchemaError(quizAssetResult.error)
      ? null
      : (quizAssetResult.data as LectureQuizAssetRow | null);
  const quizQuestions =
    quizQuestionsResult.error && isMissingQuizSchemaError(quizQuestionsResult.error)
      ? []
      : ((quizQuestionsResult.data ?? []) as QuizQuestionRow[]);

  if (studySectionsResult.error && !isMissingStudySectionsSchemaError(studySectionsResult.error)) {
    throw studySectionsResult.error;
  }

  const flashcardRows = (flashcards ?? []) as FlashcardRow[];
  const flashcardIds = flashcardRows.map((flashcard) => flashcard.id);
  const { data: flashcardProgress, error: flashcardProgressError } =
    flashcardIds.length > 0
      ? await supabase
          .from("flashcard_progress")
          .select("*")
          .eq("user_id", params.userId)
          .in("flashcard_id", flashcardIds)
      : { data: [], error: null };

  if (flashcardProgressError) {
    throw flashcardProgressError;
  }

  const progressByFlashcardId = new Map(
    ((flashcardProgress ?? []) as FlashcardProgressRow[]).map((progress) => [
      progress.flashcard_id,
      progress,
    ]),
  );
  const mappedFlashcards = flashcardRows.map((flashcard) => ({
    ...mapFlashcard(flashcard),
    progress: progressByFlashcardId.get(flashcard.id) ?? null,
  }));

  let audioUrl: string | null = null;

  if (lectureRow.storage_path) {
    const { data: signed } = await service.storage
      .from("lecture-audio")
      .createSignedUrl(lectureRow.storage_path, 60 * 60);

    audioUrl = signed?.signedUrl ?? null;
  }

  return {
    lecture: lectureRow,
    artifact: artifact as LectureArtifactRow | null,
    studyAsset: studyAsset as LectureStudyAssetRow | null,
    quizAsset,
    studySections: buildStudySections({
      lectureId: lectureRow.id,
      flashcards: mappedFlashcards,
      sections: studySections,
    }),
    flashcards: mappedFlashcards,
    quizQuestions: quizQuestions.map(mapQuizQuestion),
    transcript: (transcript ?? []) as TranscriptSegmentRow[],
    chatMessages: (chatMessages ?? []).map(mapChatMessage),
    audioUrl,
  };
}

export async function ensureUserOwnsLecture(params: {
  lectureId: string;
  user: User;
}): Promise<LectureRow | null> {
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
