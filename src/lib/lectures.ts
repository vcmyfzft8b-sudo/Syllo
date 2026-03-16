import "server-only";

import type { User } from "@supabase/supabase-js";

import type {
  ChatMessageRow,
  Citation,
  FlashcardRow,
  FlashcardProgressRow,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import type {
  AppLectureListItem,
  ChatMessageWithCitations,
  FlashcardWithCitations,
  LectureDetail,
} from "@/lib/types";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

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

  const [
    { data: artifact, error: artifactError },
    { data: studyAsset, error: studyAssetError },
    { data: flashcards, error: flashcardsError },
    { data: transcript, error: transcriptError },
    { data: chatMessages, error: chatError },
  ] =
    await Promise.all([
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
    flashcards: flashcardRows.map((flashcard) => ({
      ...mapFlashcard(flashcard),
      progress: progressByFlashcardId.get(flashcard.id) ?? null,
    })),
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
