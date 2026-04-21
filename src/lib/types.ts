import type {
  ChatMessageRow,
  Citation,
  FlashcardConfidenceBucket,
  FlashcardRow,
  FlashcardProgressRow,
  LectureArtifactRow,
  LecturePracticeTestAssetRow,
  LectureQuizAssetRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySessionRow,
  LectureStudySectionRow,
  PracticeTestAttemptAnswerRow,
  PracticeTestAttemptRow,
  PracticeTestQuestionRow,
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
  practiceTestAsset: LecturePracticeTestAssetRow | null;
  studySession: StudySession | null;
  studySections: StudySectionWithProgress[];
  flashcards: FlashcardWithCitations[];
  quizQuestions: QuizQuestionWithOptions[];
  practiceTestQuestions: PracticeTestQuestion[];
  practiceTestAttempts: PracticeTestAttemptWithAnswers[];
  practiceTestHistorySummary: PracticeTestHistorySummary;
  transcript: TranscriptSegmentRow[];
  chatMessages: ChatMessageWithCitations[];
  audioUrl: string | null;
  degraded?: {
    reason: string;
    failedSections: string[];
  };
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

export type PracticeTestQuestion = PracticeTestQuestionRow;

export interface PracticeTestAttemptAnswer extends PracticeTestAttemptAnswerRow {
  question: PracticeTestQuestion | null;
}

export interface PracticeTestAttemptWithAnswers extends PracticeTestAttemptRow {
  answers: PracticeTestAttemptAnswer[];
}

export interface PracticeTestHistoryEntry {
  attemptId: string;
  attemptNumber: number;
  createdAt: string;
  percentage: number;
  totalScore: number;
  maxScore: number;
}

export interface PracticeTestHistorySummary {
  attemptCount: number;
  averagePercentage: number | null;
  bestPercentage: number | null;
  lowestPercentage: number | null;
  latestPercentage: number | null;
  scoresByAttempt: PracticeTestHistoryEntry[];
}

export interface PersistedFlashcardSessionResult {
  attempts: number;
  firstConfidence: FlashcardConfidenceBucket;
  latestConfidence: FlashcardConfidenceBucket;
}

export interface PersistedFlashcardSessionState {
  reviewQueue: string[];
  repeatQueue: string[];
  reviewCycle: number;
  cycleCardCount: number;
  roundSummary: {
    cycle: number;
    total: number;
    known: number;
    missed: number;
  } | null;
  sessionResults: Record<string, PersistedFlashcardSessionResult>;
}

export interface PersistedQuizSessionState {
  quizQueue: string[];
  quizRound: number;
  quizRoundCount: number;
  roundSummary: {
    cycle: number;
    total: number;
    correct: number;
    missed: number;
    missedQuestionIds: string[];
  } | null;
  activeQuestionIndex: number;
  selections: Record<string, number>;
  optionOrders: Record<string, number[]>;
}

export interface PersistedPracticeTestSessionState {
  currentAttemptId: string | null;
  attemptQuestionIds: string[];
  textAnswers: Record<string, string>;
  unknownQuestionIds: string[];
  latestViewedAttemptId: string | null;
  submittedAt: string | null;
}

export interface StudySession
  extends Omit<LectureStudySessionRow, "flashcard_state" | "quiz_state" | "practice_test_state"> {
  flashcard_state: PersistedFlashcardSessionState | null;
  quiz_state: PersistedQuizSessionState | null;
  practice_test_state: PersistedPracticeTestSessionState | null;
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
