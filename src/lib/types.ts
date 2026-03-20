import type {
  ChatMessageRow,
  Citation,
  FlashcardRow,
  FlashcardProgressRow,
  LectureArtifactRow,
  LectureQuizAssetRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySectionRow,
  ProfileRow,
  QuizQuestionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";

export interface AppLectureListItem extends LectureRow {
  profile?: ProfileRow | null;
}

export interface LectureDetail {
  lecture: LectureRow;
  artifact: LectureArtifactRow | null;
  studyAsset: LectureStudyAssetRow | null;
  quizAsset: LectureQuizAssetRow | null;
  studySections: StudySectionWithProgress[];
  flashcards: FlashcardWithCitations[];
  quizQuestions: QuizQuestionWithOptions[];
  transcript: TranscriptSegmentRow[];
  chatMessages: ChatMessageWithCitations[];
  audioUrl: string | null;
}

export interface ChatMessageWithCitations extends Omit<ChatMessageRow, "citations_json"> {
  citations: Citation[];
}

export interface FlashcardWithCitations extends Omit<FlashcardRow, "citations_json"> {
  citations: Citation[];
  progress: FlashcardProgressRow | null;
}

export interface QuizQuestionWithOptions extends Omit<QuizQuestionRow, "options_json"> {
  options: string[];
}

export interface StudySectionWithProgress extends LectureStudySectionRow {
  reviewedCount: number;
  completed: boolean;
}

export interface CreateLectureResponse {
  lectureId: string;
  path: string;
  token: string;
}

export interface NoteGenerationResult {
  title: string;
  summary: string;
  keyTopics: string[];
  structuredNotesMd: string;
  modelMetadata: Record<string, unknown>;
}

export interface TranscriptSegmentInput {
  idx: number;
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  text: string;
}

export interface TranscriptResult {
  text: string;
  durationSeconds: number;
  segments: TranscriptSegmentInput[];
}
