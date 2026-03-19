import type {
  ChatMessageRow,
  Citation,
  FlashcardRow,
  FlashcardProgressRow,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySectionRow,
  ProfileRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";

export interface AppLectureListItem extends LectureRow {
  profile?: ProfileRow | null;
}

export interface LectureDetail {
  lecture: LectureRow;
  artifact: LectureArtifactRow | null;
  studyAsset: LectureStudyAssetRow | null;
  studySections: StudySectionWithProgress[];
  flashcards: FlashcardWithCitations[];
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

export interface StudySectionWithProgress extends LectureStudySectionRow {
  reviewedCount: number;
  completed: boolean;
}

export interface CreateLectureResponse {
  lectureId: string;
  path: string;
  token: string;
}

export type NoteStudyPointType =
  | "definition"
  | "process"
  | "comparison"
  | "cause_effect"
  | "example"
  | "term"
  | "sequence"
  | "formula"
  | "warning";

export type NoteStudyPointValue = "high" | "medium" | "low";

export interface NoteStudyPoint {
  pointKey: string;
  text: string;
  pointType: NoteStudyPointType;
  studyValue: NoteStudyPointValue;
}

export interface NoteStudySection {
  title: string;
  summary: string;
  points: NoteStudyPoint[];
}

export interface NoteGenerationResult {
  title: string;
  summary: string;
  keyTopics: string[];
  structuredNotesMd: string;
  studyOutline: NoteStudySection[];
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
