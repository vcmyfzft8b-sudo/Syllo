"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Loader2,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import { NoteReadAloud } from "@/components/note-read-aloud";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { parseApiResponse, redirectToBillingIfNeeded } from "@/lib/billing-client";
import type { FlashcardConfidenceBucket, StudyAssetStatus } from "@/lib/database.types";
import {
  getEffectiveLectureSourceType,
  isRecord,
  lectureShowsTranscript,
} from "@/lib/lecture-source-metadata";
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import {
  POLL_INTERVAL_MS,
} from "@/lib/constants";
import { useRouter } from "next/navigation";
import type {
  ChatMessageWithCitations,
  LectureDetail,
  PersistedFlashcardSessionState,
  PersistedPracticeTestSessionState,
  PersistedQuizSessionState,
  QuizQuestionWithOptions,
} from "@/lib/types";
import {
  formatCalendarDate,
  formatTimestamp,
} from "@/lib/utils";

type WorkspaceTab = "notes" | "study" | "chat" | "transcript" | "audio";
type StudyMaterialView = "flashcards" | "quiz" | "practice_test";
type FlashcardSessionResult = {
  attempts: number;
  firstConfidence: FlashcardConfidenceBucket;
  latestConfidence: FlashcardConfidenceBucket;
};

type FlashcardRoundSummary = {
  cycle: number;
  total: number;
  known: number;
  missed: number;
};

type FlashcardExitAnimation = {
  flashcard: LectureDetail["flashcards"][number];
  bucket: FlashcardConfidenceBucket;
  flipped: boolean;
  token: number;
  startXPercent: number;
  startYPercent: number;
  startRotationDeg: number;
};

type FlashcardDragState = {
  isDragging: boolean;
  deltaX: number;
  deltaY: number;
  width: number;
};

type FlashcardDragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
};

type FlashcardExitStart = {
  xPercent: number;
  yPercent: number;
  rotationDeg: number;
};

type QuizRoundSummary = {
  cycle: number;
  total: number;
  correct: number;
  missed: number;
  missedQuestionIds: string[];
};

type FlashcardProgressResponse = {
  error?: string;
  progress?: LectureDetail["flashcards"][number]["progress"];
};

type ChatResponse = {
  answer?: ChatMessageWithCitations;
  code?: string;
  error?: string;
};

type StudySessionSnapshot = {
  savedAt: string;
  activeStudyView: StudyMaterialView;
  flashcardState: PersistedFlashcardSessionState | null;
  quizState: PersistedQuizSessionState | null;
  practiceTestState: PersistedPracticeTestSessionState | null;
};

const STUDY_SESSION_STORAGE_KEY_PREFIX = "lecture-study-session:";
const NETWORK_REQUEST_ERROR_MESSAGE = "Povezava je bila prekinjena. Poskusi znova.";
const FAST_DETAIL_POLL_INTERVAL_MS = 5000;
const MIN_DETAIL_REFRESH_INTERVAL_MS = 3000;
const STUDY_SESSION_SAVE_DEBOUNCE_MS = 5000;

function ignoreBackgroundRequestError() {
  return null;
}

function isInterruptedFetchError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "NetworkError";
  }

  return error instanceof TypeError && /failed to fetch|load failed|network/i.test(error.message);
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (isInterruptedFetchError(error)) {
    return NETWORK_REQUEST_ERROR_MESSAGE;
  }

  return error instanceof Error ? error.message : fallback;
}

function getTabItems({
  hasAudio,
  showsTranscript,
}: {
  hasAudio: boolean;
  showsTranscript: boolean;
}) {
  const items: Array<{
    id: WorkspaceTab;
    label: string;
    icon: string;
  }> = [
    { id: "notes", label: "Zapiski", icon: "📝" },
    { id: "study", label: "Učenje", icon: "🧠" },
    { id: "chat", label: "Klepet", icon: "💬" },
  ];

  if (showsTranscript) {
    items.push({ id: "transcript", label: "Prepis", icon: "📜" });
  }

  if (hasAudio) {
    items.push({ id: "audio", label: "Zvok", icon: "🎧" });
  }

  return items;
}

function shouldPollLecture(status: LectureDetail["lecture"]["status"]) {
  return ["uploading", "queued", "transcribing", "generating_notes"].includes(status);
}

function shouldPollAsset(status: StudyAssetStatus | null | undefined) {
  return status === "queued" || status === "generating";
}

function shouldPollDetail(detail: LectureDetail) {
  if (shouldPollLecture(detail.lecture.status)) {
    return true;
  }

  if (detail.lecture.status === "ready" && !detail.artifact) {
    return true;
  }

  if (
    (detail.flashcards.length === 0 && shouldPollAsset(detail.studyAsset?.status)) ||
    shouldPollAsset(detail.quizAsset?.status)
  ) {
    return true;
  }

  if (shouldPollAsset(detail.practiceTestAsset?.status)) {
    return true;
  }

  if (detail.studyAsset?.status === "ready" && detail.flashcards.length === 0) {
    return true;
  }

  if (detail.quizAsset?.status === "ready" && detail.quizQuestions.length === 0) {
    return true;
  }

  if (detail.practiceTestAsset?.status === "ready" && detail.practiceTestQuestions.length === 0) {
    return true;
  }

  return false;
}

function getStudySessionStorageKey(lectureId: string) {
  return `${STUDY_SESSION_STORAGE_KEY_PREFIX}${lectureId}`;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function readStudySessionSnapshot(lectureId: string): StudySessionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getStudySessionStorageKey(lectureId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StudySessionSnapshot>;
    if (
      typeof parsed.savedAt !== "string" ||
      (parsed.activeStudyView !== "flashcards" &&
        parsed.activeStudyView !== "quiz" &&
        parsed.activeStudyView !== "practice_test")
    ) {
      return null;
    }

    return {
      savedAt: parsed.savedAt,
      activeStudyView: parsed.activeStudyView,
      flashcardState: parsed.flashcardState ?? null,
      quizState: parsed.quizState ?? null,
      practiceTestState: parsed.practiceTestState ?? null,
    };
  } catch {
    return null;
  }
}

function writeStudySessionSnapshot(lectureId: string, snapshot: StudySessionSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getStudySessionStorageKey(lectureId), JSON.stringify(snapshot));
  } catch {}
}

function mergeLectureDetailWithStoredStudySession(detail: LectureDetail) {
  const snapshot = readStudySessionSnapshot(detail.lecture.id);
  if (!snapshot) {
    return detail;
  }

  if (toTimestamp(snapshot.savedAt) <= toTimestamp(detail.studySession?.updated_at)) {
    return detail;
  }

  return {
    ...detail,
    studySession: {
      user_id: detail.studySession?.user_id ?? detail.lecture.user_id,
      lecture_id: detail.lecture.id,
      active_study_view: snapshot.activeStudyView,
      flashcard_state: snapshot.flashcardState,
      quiz_state: snapshot.quizState,
      practice_test_state: snapshot.practiceTestState,
      created_at: detail.studySession?.created_at ?? snapshot.savedAt,
      updated_at: snapshot.savedAt,
    },
  };
}

function detailSectionFailed(detail: LectureDetail, section: string) {
  return detail.degraded?.failedSections.includes(section) ?? false;
}

function mergeLectureDetailForRefresh(current: LectureDetail, next: LectureDetail) {
  const merged = mergeLectureDetailWithStoredStudySession(next);

  if (
    current.lecture.id === merged.lecture.id &&
    current.lecture.status === "ready" &&
    merged.lecture.status !== "ready" &&
    toTimestamp(merged.lecture.updated_at) <= toTimestamp(current.lecture.updated_at)
  ) {
    return current;
  }

  if (
    current.lecture.id === merged.lecture.id &&
    current.artifact?.structured_notes_md?.trim() &&
    !merged.artifact?.structured_notes_md?.trim() &&
    detailSectionFailed(merged, "artifact")
  ) {
    return {
      ...merged,
      artifact: current.artifact,
    };
  }

  return merged;
}

function confidenceLabel(value: FlashcardConfidenceBucket) {
  if (value === "again") {
    return "Nisem vedel";
  }
  return "Vedel sem";
}

const FLASHCARD_EXIT_ANIMATION_MS = 193;
const FLASHCARD_DRAG_TRIGGER_RATIO = 0.28;
const FLASHCARD_DRAG_TRIGGER_MIN_PX = 88;
const FLASHCARD_DRAG_TRIGGER_MAX_PX = 150;
const FLASHCARD_DRAG_MAX_ROTATION_DEG = 8;

function sourceLabel(sourceType: string) {
  if (sourceType === "link") {
    return "Spletna povezava";
  }

  if (sourceType === "text") {
    return "Besedilo";
  }

  if (sourceType === "pdf") {
    return "PDF dokument";
  }

  if (sourceType === "presentation") {
    return "PowerPoint predstavitev";
  }

  return "Zvočni posnetek";
}

function isScanImport(detail: LectureDetail) {
  const sourceType = getEffectiveLectureSourceType(detail.lecture);

  return lectureShowsTranscript({
    lecture: detail.lecture,
    artifact: detail.artifact,
  }) && sourceType !== "audio";
}

function getScanTranscriptFallback(detail: LectureDetail) {
  if (!isScanImport(detail)) {
    return [];
  }

  const metadata = detail.lecture.processing_metadata;

  if (!isRecord(metadata)) {
    return [];
  }

  const manualImport = metadata.manualImport;

  if (!isRecord(manualImport)) {
    return [];
  }

  const blocks = Array.isArray(manualImport.blocks) ? manualImport.blocks : [];
  const segments: Array<{
    id: string;
    start_ms: number;
    end_ms: number;
    speaker_label: string | null;
    text: string;
  }> = [];
  let startMs = 0;

  for (const [index, block] of blocks.entries()) {
    if (!isRecord(block)) {
      continue;
    }

    const text = typeof block.text === "string" ? block.text.trim() : "";

    if (!text) {
      continue;
    }

    const label = typeof block.label === "string" && block.label.trim() ? block.label.trim() : null;
    const pageNumber = typeof block.pageNumber === "number" ? block.pageNumber : null;
    const durationMs = Math.max(Math.round(text.split(/\s+/).filter(Boolean).length * 420), 6000);

    segments.push({
      id: `scan-fallback-${index}`,
      start_ms: startMs,
      end_ms: startMs + durationMs,
      speaker_label:
        pageNumber != null
          ? label
            ? `Page ${pageNumber} · ${label}`
            : `Page ${pageNumber}`
          : label,
      text,
    });
    startMs += durationMs;
  }

  if (segments.length > 0) {
    return segments;
  }

  const text = typeof manualImport.text === "string" ? manualImport.text.trim() : "";

  if (!text) {
    return [];
  }

  return [
    {
      id: "scan-fallback-text",
      start_ms: 0,
      end_ms: Math.max(Math.round(text.split(/\s+/).filter(Boolean).length * 420), 6000),
      speaker_label: null,
      text,
    },
  ];
}

function formatScanTranscriptLabel(label: string | null) {
  if (!label?.trim()) {
    return "Prepis fotografije";
  }

  return label.trim().replace(/^Page\s+(\d+)/i, "Stran $1");
}

function studyStageLabel(stage: unknown) {
  if (stage === "building_sections") {
    return "Gradim učne sklope";
  }

  if (stage === "planning_coverage") {
    return "Izluščujem pojme";
  }

  if (stage === "generating_cards") {
    return "Ustvarjam kartice";
  }

  if (stage === "repairing_coverage") {
    return "Zapolnjujem vrzeli";
  }

  if (stage === "publishing_deck") {
    return "Preverjam pokritost";
  }

  return "Pripravljam učna orodja";
}

function quizStageLabel(stage: unknown) {
  if (stage === "generating_questions") {
    return "Ustvarjam kviz";
  }

  if (stage === "publishing_quiz") {
    return "Objavljam kviz";
  }

  if (stage === "ready") {
    return "Kviz je pripravljen";
  }

  return "Pripravljam kviz";
}

function practiceTestStageLabel(stage: unknown) {
  if (stage === "generating_question_bank") {
    return "Sestavljam vprašanja";
  }

  if (stage === "ready") {
    return "Preizkus je pripravljen";
  }

  return "Pripravljam preizkus";
}

function lectureProcessingStageLabel(status: LectureDetail["lecture"]["status"]) {
  if (status === "uploading") {
    return "Nalagam gradivo";
  }

  if (status === "queued") {
    return "Pripravljam obdelavo";
  }

  if (status === "transcribing") {
    return "Prepisujem predavanje";
  }

  if (status === "generating_notes") {
    return "Ustvarjam zapiske";
  }

  return "Pripravljam zapiske";
}

function studyAssetStatusLabel(status: StudyAssetStatus | null | undefined) {
  if (status === "queued") {
    return "Priprava";
  }

  if (status === "generating") {
    return "Ustvarjanje";
  }

  if (status === "failed") {
    return "Napaka";
  }

  if (status === "ready") {
    return "Pripravljeno";
  }

  return null;
}

function StudyGenerationNotice({
  stageCopy,
  bodyCopy = "Ustvarjanje teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut.",
}: {
  stageCopy: string;
  bodyCopy?: string;
}) {
  return (
    <div className="lecture-study-generation-notice" role="status" aria-live="polite">
      <div className="lecture-study-generation-loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="lecture-study-generation-copy">
        <p className="lecture-study-generation-stage">{stageCopy}</p>
        <p>{bodyCopy}</p>
      </div>
    </div>
  );
}

function isLegacySectionId(value: string) {
  return value.startsWith("legacy-");
}

function randomInt(maxExclusive: number) {
  if (maxExclusive <= 1) {
    return 0;
  }

  if (!globalThis.crypto?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const maxUint32 = 0x1_0000_0000;
  const biasSafeLimit = maxUint32 - (maxUint32 % maxExclusive);
  const buffer = new Uint32Array(1);
  let randomValue = 0;

  do {
    globalThis.crypto.getRandomValues(buffer);
    randomValue = buffer[0] ?? 0;
  } while (randomValue >= biasSafeLimit);

  return randomValue % maxExclusive;
}

function shuffleIndices(length: number) {
  const indices = Array.from({ length }, (_, index) => index);

  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const currentValue = indices[index];
    indices[index] = indices[swapIndex] ?? index;
    indices[swapIndex] = currentValue ?? swapIndex;
  }

  return indices;
}

function buildQuizOptionOrders(
  questionIds: string[],
  questionsById: Map<string, QuizQuestionWithOptions>,
) {
  return new Map(
    questionIds.flatMap((questionId) => {
      const question = questionsById.get(questionId);

      if (!question) {
        return [];
      }

      return [[questionId, shuffleIndices(question.options.length)]];
    }),
  );
}

function getInitialStudyView(detail: LectureDetail): StudyMaterialView {
  if (detail.studySession?.active_study_view === "flashcards" && detail.flashcards.length > 0) {
    return "flashcards";
  }

  if (detail.studySession?.active_study_view === "quiz" && detail.quizQuestions.length > 0) {
    return "quiz";
  }

  if (
    detail.studySession?.active_study_view === "practice_test" &&
    detail.practiceTestQuestions.length > 0
  ) {
    return "practice_test";
  }

  if (detail.flashcards.length > 0) {
    return "flashcards";
  }

  if (detail.quizQuestions.length > 0) {
    return "quiz";
  }

  if (detail.practiceTestQuestions.length > 0) {
    return "practice_test";
  }

  return "flashcards";
}

function buildDefaultFlashcardSessionState(
  flashcardIds: string[],
): PersistedFlashcardSessionState {
  return {
    reviewQueue: flashcardIds,
    repeatQueue: [],
    activeFlashcardIndex: 0,
    reviewCycle: 1,
    cycleCardCount: flashcardIds.length,
    roundSummary: null,
    sessionResults: {},
  };
}

function sanitizeFlashcardSessionState(
  session: PersistedFlashcardSessionState | null | undefined,
  flashcardIds: string[],
): PersistedFlashcardSessionState {
  const validIds = new Set(flashcardIds);
  const fallback = buildDefaultFlashcardSessionState(flashcardIds);

  if (!session) {
    return fallback;
  }

  let reviewQueue = session.reviewQueue.filter((id) => validIds.has(id));
  const repeatQueue = session.repeatQueue.filter((id) => validIds.has(id));
  const sessionResults = Object.fromEntries(
    Object.entries(session.sessionResults).filter(([id]) => validIds.has(id)),
  );
  const roundSummary = session.roundSummary
    ? {
        cycle: Math.max(1, session.roundSummary.cycle),
        total: Math.max(0, session.roundSummary.total),
        known: Math.max(0, session.roundSummary.known),
        missed: Math.max(0, session.roundSummary.missed),
      }
    : null;
  const hasPersistedActiveIndex =
    typeof session.activeFlashcardIndex === "number" && session.activeFlashcardIndex >= 0;
  let activeFlashcardIndex =
    reviewQueue.length > 0
      ? Math.min(Math.max(0, session.activeFlashcardIndex ?? 0), reviewQueue.length - 1)
      : 0;

  if (!hasPersistedActiveIndex && flashcardIds.length > 0 && !roundSummary) {
    const activeFlashcardId = reviewQueue[0];
    activeFlashcardIndex = activeFlashcardId
      ? Math.max(0, flashcardIds.findIndex((id) => id === activeFlashcardId))
      : 0;
    reviewQueue = flashcardIds;
  }

  if (flashcardIds.length > 0 && reviewQueue.length === 0 && !roundSummary) {
    return fallback;
  }

  return {
    reviewQueue,
    repeatQueue,
    activeFlashcardIndex,
    reviewCycle: Math.max(1, session.reviewCycle),
    cycleCardCount: Math.max(0, session.cycleCardCount),
    roundSummary,
    sessionResults,
  };
}

function serializeQuizOptionOrders(optionOrders: Map<string, number[]>) {
  return Object.fromEntries(optionOrders.entries());
}

function buildDefaultQuizSessionState(
  questionIds: string[],
  questionsById: Map<string, QuizQuestionWithOptions>,
): PersistedQuizSessionState {
  return {
    quizQueue: questionIds,
    quizRound: 1,
    quizRoundCount: questionIds.length,
    roundSummary: null,
    activeQuestionIndex: 0,
    selections: {},
    optionOrders: serializeQuizOptionOrders(buildQuizOptionOrders(questionIds, questionsById)),
  };
}

function sanitizeQuizSessionState(
  session: PersistedQuizSessionState | null | undefined,
  questionIds: string[],
  questionsById: Map<string, QuizQuestionWithOptions>,
): PersistedQuizSessionState {
  const validIds = new Set(questionIds);
  const fallback = buildDefaultQuizSessionState(questionIds, questionsById);

  if (!session) {
    return fallback;
  }

  const quizQueue = session.quizQueue.filter((id) => validIds.has(id));
  const selections = Object.fromEntries(
    Object.entries(session.selections).filter(([id, optionIndex]) => {
      const question = questionsById.get(id);
      return !!question && optionIndex >= 0 && optionIndex < question.options.length;
    }),
  );
  const optionOrders = Object.fromEntries(
    Object.entries(session.optionOrders).flatMap(([id, order]) => {
      const question = questionsById.get(id);

      if (!question || order.length !== question.options.length) {
        return [];
      }

      const normalizedOrder = order.filter(
        (optionIndex) =>
          Number.isInteger(optionIndex) &&
          optionIndex >= 0 &&
          optionIndex < question.options.length,
      );

      if (new Set(normalizedOrder).size !== question.options.length) {
        return [];
      }

      return [[id, normalizedOrder]];
    }),
  );
  const roundSummary = session.roundSummary
    ? {
        cycle: Math.max(1, session.roundSummary.cycle),
        total: Math.max(0, session.roundSummary.total),
        correct: Math.max(0, session.roundSummary.correct),
        missed: Math.max(0, session.roundSummary.missed),
        missedQuestionIds: session.roundSummary.missedQuestionIds.filter((id) => validIds.has(id)),
      }
    : null;

  if (questionIds.length > 0 && quizQueue.length === 0 && !roundSummary) {
    return fallback;
  }

  return {
    quizQueue,
    quizRound: Math.max(1, session.quizRound),
    quizRoundCount: Math.max(0, session.quizRoundCount),
    roundSummary,
    activeQuestionIndex:
      quizQueue.length > 0
        ? Math.min(Math.max(0, session.activeQuestionIndex), quizQueue.length - 1)
        : 0,
    selections,
    optionOrders: {
      ...fallback.optionOrders,
      ...optionOrders,
    },
  };
}

function sanitizePracticeTestSessionState(
  session: PersistedPracticeTestSessionState | null | undefined,
  detail: LectureDetail,
): PersistedPracticeTestSessionState {
  const attemptsById = new Map(detail.practiceTestAttempts.map((attempt) => [attempt.id, attempt]));
  const currentAttemptCandidate =
    session?.currentAttemptId ? attemptsById.get(session.currentAttemptId) ?? null : null;
  const currentAttempt =
    (currentAttemptCandidate?.status === "in_progress" ? currentAttemptCandidate : null) ??
    detail.practiceTestAttempts.find((attempt) => attempt.status === "in_progress") ??
    null;
  const latestGradedAttempt =
    detail.practiceTestAttempts
      .filter((attempt) => attempt.status === "graded")
      .slice(-1)[0] ?? null;
  const attemptQuestionIds = currentAttempt
    ? currentAttempt.answers
        .map((answer) => answer.practice_test_question_id)
        .filter((id): id is string => Boolean(id))
    : [];
  const validQuestionIds = new Set(attemptQuestionIds);
  const textAnswers = Object.fromEntries(
    Object.entries(session?.textAnswers ?? {}).filter(([questionId]) => validQuestionIds.has(questionId)),
  );

  for (const answer of currentAttempt?.answers ?? []) {
    const questionKey = answer.practice_test_question_id ?? `snapshot-${answer.id}`;

    if (!textAnswers[questionKey] && answer.typed_answer) {
      textAnswers[questionKey] = answer.typed_answer;
    }
  }

  return {
    currentAttemptId: currentAttempt?.id ?? null,
    attemptQuestionIds,
    textAnswers,
    unknownQuestionIds: (session?.unknownQuestionIds ?? []).filter((id) => validQuestionIds.has(id)),
    latestViewedAttemptId:
      session?.latestViewedAttemptId ??
      latestGradedAttempt?.id ??
      currentAttempt?.id ??
      null,
    submittedAt: session?.submittedAt ?? null,
  };
}

function ChatBubble({ message }: { message: ChatMessageWithCitations }) {
  const assistant = message.role === "assistant";

  return (
    <div className={`lecture-chat-message ${assistant ? "assistant" : "user"}`}>
      <div className="lecture-chat-bubble">
        <p className="lecture-chat-copy">{message.content}</p>
        {message.citations.length > 0 ? (
          <div className="lecture-chat-citations">
            {message.citations.map((citation) => (
              <span
                key={`${message.id}-${citation.idx}-${citation.startMs}`}
                className="lecture-chat-citation"
              >
                {formatTimestamp(citation.startMs)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LectureWorkspace({
  initialDetail,
  hasPaidAccess,
  trialLectureId,
  initialTrialChatMessagesRemaining,
}: {
  initialDetail: LectureDetail;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  initialTrialChatMessagesRemaining: number;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("notes");
  const [question, setQuestion] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [trialChatMessagesRemaining, setTrialChatMessagesRemaining] = useState(
    initialTrialChatMessagesRemaining,
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRegeneratingStudy, setIsRegeneratingStudy] = useState(false);
  const [isRegeneratingQuiz, setIsRegeneratingQuiz] = useState(false);
  const [isStartingPracticeTest, setIsStartingPracticeTest] = useState(false);
  const [isAwaitingStudyGeneration, setIsAwaitingStudyGeneration] = useState(false);
  const [isAwaitingQuizGeneration, setIsAwaitingQuizGeneration] = useState(false);
  const [isAwaitingPracticeTestGeneration, setIsAwaitingPracticeTestGeneration] = useState(false);
  const [isSubmittingPracticeTest, setIsSubmittingPracticeTest] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
  const [activeStudyView, setActiveStudyView] = useState<StudyMaterialView>(
    getInitialStudyView(initialDetail),
  );
  const initialFlashcardSession = sanitizeFlashcardSessionState(
    initialDetail.studySession?.flashcard_state,
    initialDetail.flashcards.map((flashcard) => flashcard.id),
  );
  const initialQuizQuestionsById = new Map(
    initialDetail.quizQuestions.map((question) => [question.id, question]),
  );
  const initialQuizSession = sanitizeQuizSessionState(
    initialDetail.studySession?.quiz_state,
    initialDetail.quizQuestions.map((question) => question.id),
    initialQuizQuestionsById,
  );
  const initialPracticeTestSession = sanitizePracticeTestSessionState(
    initialDetail.studySession?.practice_test_state,
    initialDetail,
  );
  const [reviewQueue, setReviewQueue] = useState<string[]>(initialFlashcardSession.reviewQueue);
  const [repeatQueue, setRepeatQueue] = useState<string[]>(initialFlashcardSession.repeatQueue);
  const [activeFlashcardIndex, setActiveFlashcardIndex] = useState(
    initialFlashcardSession.activeFlashcardIndex,
  );
  const [reviewCycle, setReviewCycle] = useState(initialFlashcardSession.reviewCycle);
  const [cycleCardCount, setCycleCardCount] = useState(initialFlashcardSession.cycleCardCount);
  const [flashcardRoundSummary, setFlashcardRoundSummary] = useState<FlashcardRoundSummary | null>(
    initialFlashcardSession.roundSummary,
  );
  const [flashcardExitAnimation, setFlashcardExitAnimation] = useState<FlashcardExitAnimation | null>(
    null,
  );
  const [flashcardDrag, setFlashcardDrag] = useState<FlashcardDragState>({
    isDragging: false,
    deltaX: 0,
    deltaY: 0,
    width: 0,
  });
  const [flashcardSessionResults, setFlashcardSessionResults] = useState<
    Record<string, FlashcardSessionResult>
  >(initialFlashcardSession.sessionResults);
  const [quizQueue, setQuizQueue] = useState<string[]>(initialQuizSession.quizQueue);
  const [quizRound, setQuizRound] = useState(initialQuizSession.quizRound);
  const [quizRoundCount, setQuizRoundCount] = useState(initialQuizSession.quizRoundCount);
  const [quizRoundSummary, setQuizRoundSummary] = useState<QuizRoundSummary | null>(
    initialQuizSession.roundSummary,
  );
  const [activeQuizQuestionIndex, setActiveQuizQuestionIndex] = useState(
    initialQuizSession.activeQuestionIndex,
  );
  const [quizSelections, setQuizSelections] = useState<Record<string, number>>(
    initialQuizSession.selections,
  );
  const [quizOptionOrders, setQuizOptionOrders] = useState<Map<string, number[]>>(
    new Map(Object.entries(initialQuizSession.optionOrders)),
  );
  const [currentPracticeAttemptId, setCurrentPracticeAttemptId] = useState<string | null>(
    initialPracticeTestSession.currentAttemptId,
  );
  const [practiceAttemptQuestionIds, setPracticeAttemptQuestionIds] = useState<string[]>(
    initialPracticeTestSession.attemptQuestionIds,
  );
  const [practiceTextAnswers, setPracticeTextAnswers] = useState<Record<string, string>>(
    initialPracticeTestSession.textAnswers,
  );
  const [practiceUnknownQuestionIds, setPracticeUnknownQuestionIds] = useState<string[]>(
    initialPracticeTestSession.unknownQuestionIds,
  );
  const [latestViewedPracticeAttemptId, setLatestViewedPracticeAttemptId] = useState<string | null>(
    initialPracticeTestSession.latestViewedAttemptId,
  );
  const [practiceSubmittedAt, setPracticeSubmittedAt] = useState<string | null>(
    initialPracticeTestSession.submittedAt,
  );
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const flashcardFeedbackTimerRef = useRef<number | null>(null);
  const flashcardFeedbackTokenRef = useRef(0);
  const flashcardDragSessionRef = useRef<FlashcardDragSession | null>(null);
  const suppressNextFlashcardClickRef = useRef(false);
  const suppressNextFlashcardClickTimerRef = useRef<number | null>(null);
  const studySessionPayloadRef = useRef<string | null>(null);
  const detailRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastDetailRefreshAtRef = useRef(0);
  const studySessionWriteInFlightRef = useRef<Promise<void> | null>(null);
  const studySessionWritePayloadRef = useRef<string | null>(null);
  const lastPersistedStudySessionPayloadRef = useRef<string | null>(null);
  const studyDeck = detail.flashcards;
  const flashcardDeckKey = studyDeck.map((flashcard) => flashcard.id).join("|");
  const quizDeckKey = detail.quizQuestions.map((question) => question.id).join("|");
  const practiceAttemptDeckKey = detail.practiceTestAttempts
    .map((attempt) => `${attempt.id}:${attempt.status}:${attempt.updated_at}`)
    .join("|");
  const isTrialLecture = !hasPaidAccess && trialLectureId === detail.lecture.id;
  const chatLimitReached = isTrialLecture && trialChatMessagesRemaining <= 0;
  const quizQuestionsById = useMemo(
    () => new Map(detail.quizQuestions.map((question) => [question.id, question])),
    [detail.quizQuestions],
  );
  const practiceAttemptsById = useMemo(
    () => new Map(detail.practiceTestAttempts.map((attempt) => [attempt.id, attempt])),
    [detail.practiceTestAttempts],
  );
  const currentReviewFlashcardId = reviewQueue[activeFlashcardIndex] ?? null;
  const showsTranscript = lectureShowsTranscript({
    lecture: detail.lecture,
    artifact: detail.artifact,
  });
  const shouldPollCurrentDetail = shouldPollDetail(detail);
  const detailPollIntervalMs =
    (detail.flashcards.length === 0 && shouldPollAsset(detail.studyAsset?.status)) ||
    shouldPollAsset(detail.quizAsset?.status)
      ? FAST_DETAIL_POLL_INTERVAL_MS
      : POLL_INTERVAL_MS;

  const refreshLectureDetail = useCallback(async (options?: { force?: boolean }) => {
    const now = Date.now();

    if (!options?.force && now - lastDetailRefreshAtRef.current < MIN_DETAIL_REFRESH_INTERVAL_MS) {
      return detailRefreshInFlightRef.current ?? undefined;
    }

    if (detailRefreshInFlightRef.current) {
      return detailRefreshInFlightRef.current;
    }

    lastDetailRefreshAtRef.current = now;

    const refreshRequest = (async () => {
      try {
        const refresh = await fetch(`/api/lectures/${detail.lecture.id}`, {
          cache: "no-store",
        });

        if (!refresh.ok) {
          return;
        }

        const nextDetail = (await refresh.json()) as LectureDetail;
        setDetail((current) => mergeLectureDetailForRefresh(current, nextDetail));
      } catch {
        return;
      }
    })().finally(() => {
      if (detailRefreshInFlightRef.current === refreshRequest) {
        detailRefreshInFlightRef.current = null;
      }
    });

    detailRefreshInFlightRef.current = refreshRequest;
    return refreshRequest;
  }, [detail.lecture.id]);

  const persistStudySessionPayload = useCallback((
    payload: string,
    options?: { force?: boolean; preferBeacon?: boolean },
  ) => {
    if (!options?.force && lastPersistedStudySessionPayloadRef.current === payload) {
      return;
    }

    if (
      studySessionWriteInFlightRef.current &&
      studySessionWritePayloadRef.current === payload
    ) {
      return;
    }

    if (
      options?.preferBeacon &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const queued = navigator.sendBeacon(
        `/api/lectures/${detail.lecture.id}/study-session`,
        new Blob([payload], {
          type: "application/json",
        }),
      );

      if (queued) {
        lastPersistedStudySessionPayloadRef.current = payload;
      }
      return;
    }

    studySessionWritePayloadRef.current = payload;
    const writeRequest = fetch(`/api/lectures/${detail.lecture.id}/study-session`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
      keepalive: true,
    })
      .then((response) => {
        if (response.ok) {
          lastPersistedStudySessionPayloadRef.current = payload;
        }
      })
      .catch(() => {
        ignoreBackgroundRequestError();
      })
      .finally(() => {
        if (studySessionWriteInFlightRef.current === writeRequest) {
          studySessionWriteInFlightRef.current = null;
          studySessionWritePayloadRef.current = null;
        }
      });

    studySessionWriteInFlightRef.current = writeRequest;
  }, [detail.lecture.id]);

  useEffect(() => {
    const nextDetail = mergeLectureDetailWithStoredStudySession(initialDetail);
    setDetail(nextDetail);
    setActiveStudyView(getInitialStudyView(nextDetail));
  }, [initialDetail]);

  useEffect(() => {
    if (activeTab === "transcript" && !showsTranscript) {
      setActiveTab("notes");
    }
  }, [activeTab, showsTranscript]);

  useEffect(() => {
    if (activeTab === "audio" && !detail.audioUrl) {
      setActiveTab("notes");
    }
  }, [activeTab, detail.audioUrl]);

  useEffect(() => {
    if (activeTab === "study") {
      setActiveStudyView((current) => {
        if (current === "practice_test" && detail.practiceTestQuestions.length > 0) {
          return current;
        }

        if (current === "quiz" && detail.quizQuestions.length > 0) {
          return current;
        }

        if (detail.flashcards.length > 0) {
          return "flashcards";
        }

        if (detail.quizQuestions.length > 0) {
          return "quiz";
        }

        if (detail.practiceTestQuestions.length > 0) {
          return "practice_test";
        }

        return "flashcards";
      });
    }
  }, [activeTab, detail.flashcards.length, detail.practiceTestQuestions.length, detail.quizQuestions.length]);

  useEffect(() => {
    if (!shouldPollCurrentDetail) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshLectureDetail();
    }, detailPollIntervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshLectureDetail({ force: true });
      }
    };

    const handleFocus = () => {
      void refreshLectureDetail();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    detail.flashcards.length,
    detail.lecture.id,
    detail.lecture.status,
    detail.practiceTestAsset?.status,
    detail.practiceTestQuestions.length,
    detail.quizAsset?.status,
    detail.quizQuestions.length,
    detailPollIntervalMs,
    refreshLectureDetail,
    detail.studyAsset?.status,
    shouldPollCurrentDetail,
  ]);

  useEffect(() => {
    setIsFlashcardFlipped(false);
    flashcardDragSessionRef.current = null;
    setFlashcardDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
  }, [activeTab, currentReviewFlashcardId]);

  useEffect(() => {
    const flashcardIds = flashcardDeckKey ? flashcardDeckKey.split("|") : [];
    const nextState = sanitizeFlashcardSessionState(
      detail.studySession?.flashcard_state,
      flashcardIds,
    );

    setReviewQueue(nextState.reviewQueue);
    setRepeatQueue(nextState.repeatQueue);
    setActiveFlashcardIndex(nextState.activeFlashcardIndex);
    setReviewCycle(nextState.reviewCycle);
    setCycleCardCount(nextState.cycleCardCount);
    setFlashcardRoundSummary(nextState.roundSummary);
    setFlashcardSessionResults(nextState.sessionResults);
    setFlashcardExitAnimation(null);
    setFlashcardDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
    setStudyError(null);
  }, [detail.studySession?.flashcard_state, flashcardDeckKey]);

  useEffect(() => {
    const quizQuestionIds = quizDeckKey ? quizDeckKey.split("|") : [];
    const nextState = sanitizeQuizSessionState(
      detail.studySession?.quiz_state,
      quizQuestionIds,
      quizQuestionsById,
    );

    setQuizQueue(nextState.quizQueue);
    setQuizRound(nextState.quizRound);
    setQuizRoundCount(nextState.quizRoundCount);
    setQuizRoundSummary(nextState.roundSummary);
    setActiveQuizQuestionIndex(nextState.activeQuestionIndex);
    setQuizSelections(nextState.selections);
    setQuizOptionOrders(new Map(Object.entries(nextState.optionOrders)));
  }, [detail.studySession?.quiz_state, quizDeckKey, quizQuestionsById]);

  useEffect(() => {
    const nextState = sanitizePracticeTestSessionState(
      detail.studySession?.practice_test_state,
      detail,
    );

    setCurrentPracticeAttemptId(nextState.currentAttemptId);
    setPracticeAttemptQuestionIds(nextState.attemptQuestionIds);
    setPracticeTextAnswers(nextState.textAnswers);
    setPracticeUnknownQuestionIds(nextState.unknownQuestionIds);
    setLatestViewedPracticeAttemptId(nextState.latestViewedAttemptId);
    setPracticeSubmittedAt(nextState.submittedAt);
  }, [detail.studySession?.practice_test_state, detail, practiceAttemptDeckKey]);

  useEffect(() => {
    return () => {
      if (flashcardFeedbackTimerRef.current) {
        window.clearTimeout(flashcardFeedbackTimerRef.current);
      }
      if (suppressNextFlashcardClickTimerRef.current) {
        window.clearTimeout(suppressNextFlashcardClickTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "chat") {
      return;
    }

    const chatScroll = chatScrollRef.current;
    if (!chatScroll) {
      return;
    }

    window.requestAnimationFrame(() => {
      chatScroll.scrollTo({
        top: chatScroll.scrollHeight,
        behavior: "auto",
      });
    });
  }, [activeTab, detail.chatMessages.length, isSending]);

  useEffect(() => {
    const nextSavedAt = new Date().toISOString();
    const nextSession = {
      activeStudyView,
      flashcardState:
        studyDeck.length > 0
          ? {
              reviewQueue,
              repeatQueue,
              activeFlashcardIndex,
              reviewCycle,
              cycleCardCount,
              roundSummary: flashcardRoundSummary,
              sessionResults: flashcardSessionResults,
            }
          : null,
      quizState:
        detail.quizQuestions.length > 0
          ? {
              quizQueue,
              quizRound,
              quizRoundCount,
              roundSummary: quizRoundSummary,
              activeQuestionIndex: activeQuizQuestionIndex,
              selections: quizSelections,
              optionOrders: serializeQuizOptionOrders(quizOptionOrders),
            }
          : null,
      practiceTestState:
        detail.practiceTestQuestions.length > 0
          ? {
              currentAttemptId: currentPracticeAttemptId,
              attemptQuestionIds: practiceAttemptQuestionIds,
              textAnswers: practiceTextAnswers,
              unknownQuestionIds: practiceUnknownQuestionIds,
              latestViewedAttemptId: latestViewedPracticeAttemptId,
              submittedAt: practiceSubmittedAt,
            }
          : null,
    };
    const payload = JSON.stringify(nextSession);

    studySessionPayloadRef.current = payload;
    writeStudySessionSnapshot(detail.lecture.id, {
      ...nextSession,
      savedAt: nextSavedAt,
    });

    const timeoutId = window.setTimeout(() => {
      persistStudySessionPayload(payload);
    }, STUDY_SESSION_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeQuizQuestionIndex,
    activeFlashcardIndex,
    activeStudyView,
    cycleCardCount,
    currentPracticeAttemptId,
    detail.lecture.id,
    detail.practiceTestQuestions.length,
    detail.quizQuestions.length,
    flashcardRoundSummary,
    flashcardSessionResults,
    latestViewedPracticeAttemptId,
    practiceAttemptQuestionIds,
    practiceSubmittedAt,
    practiceTextAnswers,
    practiceUnknownQuestionIds,
    quizOptionOrders,
    quizQueue,
    quizRound,
    quizRoundCount,
    quizRoundSummary,
    quizSelections,
    repeatQueue,
    reviewCycle,
    reviewQueue,
    persistStudySessionPayload,
    studyDeck.length,
  ]);

  useEffect(() => {
    const flushStudySession = (preferBeacon = false) => {
      if (!studySessionPayloadRef.current) {
        return;
      }

      persistStudySessionPayload(studySessionPayloadRef.current, {
        force: true,
        preferBeacon,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushStudySession(true);
      }
    };

    const handlePageHide = () => {
      flushStudySession(true);
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      flushStudySession();
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistStudySessionPayload]);
  const cleanedStructuredNotes = useMemo(() => {
    if (!detail.artifact?.structured_notes_md) {
      return null;
    }

    return stripLeadingRedundantHeading(
      detail.artifact.structured_notes_md,
      detail.lecture.title,
    );
  }, [detail.artifact?.structured_notes_md, detail.lecture.title]);
  const notesArtifactLoadFailed =
    !cleanedStructuredNotes &&
    detail.lecture.status === "ready" &&
    detailSectionFailed(detail, "artifact");
  const studyStage =
    detail.studyAsset?.model_metadata &&
    typeof detail.studyAsset.model_metadata === "object" &&
    !Array.isArray(detail.studyAsset.model_metadata) &&
    "stage" in detail.studyAsset.model_metadata
      ? detail.studyAsset.model_metadata.stage
      : null;
  const studyStageCopy = studyStageLabel(studyStage);
  const quizStage =
    detail.quizAsset?.model_metadata &&
    typeof detail.quizAsset.model_metadata === "object" &&
    !Array.isArray(detail.quizAsset.model_metadata) &&
    "stage" in detail.quizAsset.model_metadata
      ? detail.quizAsset.model_metadata.stage
      : null;
  const quizStageCopy = quizStageLabel(quizStage);
  const practiceTestStage =
    detail.practiceTestAsset?.model_metadata &&
    typeof detail.practiceTestAsset.model_metadata === "object" &&
    !Array.isArray(detail.practiceTestAsset.model_metadata) &&
    "stage" in detail.practiceTestAsset.model_metadata
      ? detail.practiceTestAsset.model_metadata.stage
      : null;
  const practiceTestStageCopy = practiceTestStageLabel(practiceTestStage);
  const lectureProcessingStageCopy = lectureProcessingStageLabel(detail.lecture.status);
  const totalFlashcards = studyDeck.length;
  const flashcardFirstPassKnownCount = studyDeck.reduce((total, flashcard) => {
    return flashcardSessionResults[flashcard.id]?.firstConfidence !== "again" &&
      flashcardSessionResults[flashcard.id]?.firstConfidence
      ? total + 1
      : total;
  }, 0);
  const flashcardConfidencePercent =
    totalFlashcards > 0 ? Math.round((flashcardFirstPassKnownCount / totalFlashcards) * 100) : 0;
  const currentQuizQuestionId = quizQueue[activeQuizQuestionIndex] ?? null;
  const activeQuizQuestion = currentQuizQuestionId
    ? (quizQuestionsById.get(currentQuizQuestionId) ?? null)
    : null;
  const activeQuizSelection =
    currentQuizQuestionId ? (quizSelections[currentQuizQuestionId] ?? null) : null;
  const activeQuizOptionOrder =
    currentQuizQuestionId && activeQuizQuestion
      ? (quizOptionOrders.get(currentQuizQuestionId) ??
        Array.from({ length: activeQuizQuestion.options.length }, (_, index) => index))
      : [];
  const totalQuizQuestions = detail.quizQuestions.length;
  const quizRoundPercent =
    quizRoundSummary && quizRoundSummary.total > 0
      ? Math.round((quizRoundSummary.correct / quizRoundSummary.total) * 100)
      : 0;
  const persistedPracticeAttempt =
    currentPracticeAttemptId ? practiceAttemptsById.get(currentPracticeAttemptId) ?? null : null;
  const currentPracticeAttempt =
    (persistedPracticeAttempt?.status === "in_progress" ? persistedPracticeAttempt : null) ??
    detail.practiceTestAttempts.find((attempt) => attempt.status === "in_progress") ??
    null;
  const latestGradedPracticeAttempt =
    [...detail.practiceTestAttempts].reverse().find((attempt) => attempt.status === "graded") ?? null;
  const visiblePracticeAttempt =
    (latestViewedPracticeAttemptId
      ? practiceAttemptsById.get(latestViewedPracticeAttemptId) ?? null
      : null) ?? latestGradedPracticeAttempt;
  const visiblePracticeAttemptPercentage = Math.round(visiblePracticeAttempt?.percentage ?? 0);
  const practiceAttemptAnswers = currentPracticeAttempt?.answers ?? [];
  const hasCompletedPracticeTest = detail.practiceTestHistorySummary.attemptCount > 0;
  const practiceQuestionsAnsweredCount = practiceAttemptAnswers.filter((answer) => {
    const questionId = answer.practice_test_question_id ?? `snapshot-${answer.id}`;
    return (
      practiceUnknownQuestionIds.includes(questionId) ||
      Boolean(practiceTextAnswers[questionId]?.trim())
    );
  }).length;
  const activeMaterialStatus =
    activeStudyView === "flashcards"
      ? totalFlashcards > 0
        ? "ready"
        : detail.studyAsset?.status
      : activeStudyView === "quiz"
        ? detail.quizAsset?.status
        : detail.practiceTestAsset?.status;
  const activeMaterialStatusLabel = studyAssetStatusLabel(activeMaterialStatus);
  const isStudyGenerating =
    totalFlashcards === 0 && (shouldPollAsset(detail.studyAsset?.status) || isAwaitingStudyGeneration);
  const isQuizGenerating = shouldPollAsset(detail.quizAsset?.status) || isAwaitingQuizGeneration;
  const isPracticeTestGenerating =
    shouldPollAsset(detail.practiceTestAsset?.status) || isAwaitingPracticeTestGeneration;

  useEffect(() => {
    if (
      isAwaitingStudyGeneration &&
      (shouldPollAsset(detail.studyAsset?.status) ||
        detail.studyAsset?.status === "failed" ||
        detail.studyAsset?.status === "ready" ||
        detail.flashcards.length > 0)
    ) {
      setIsAwaitingStudyGeneration(false);
    }
  }, [detail.flashcards.length, detail.studyAsset?.status, isAwaitingStudyGeneration]);

  useEffect(() => {
    if (
      isAwaitingQuizGeneration &&
      (shouldPollAsset(detail.quizAsset?.status) ||
        detail.quizAsset?.status === "failed" ||
        detail.quizAsset?.status === "ready" ||
        detail.quizQuestions.length > 0)
    ) {
      setIsAwaitingQuizGeneration(false);
    }
  }, [detail.quizAsset?.status, detail.quizQuestions.length, isAwaitingQuizGeneration]);

  useEffect(() => {
    if (
      isAwaitingPracticeTestGeneration &&
      (shouldPollAsset(detail.practiceTestAsset?.status) ||
        detail.practiceTestAsset?.status === "failed" ||
        detail.practiceTestQuestions.length > 0 ||
        detail.practiceTestAttempts.some((attempt) => attempt.status === "in_progress"))
    ) {
      setIsAwaitingPracticeTestGeneration(false);
    }
  }, [
    detail.practiceTestAsset?.status,
    detail.practiceTestAttempts,
    detail.practiceTestQuestions.length,
    isAwaitingPracticeTestGeneration,
  ]);

  async function handleRetry() {
    setIsRetrying(true);
    const response = await fetch(`/api/lectures/${detail.lecture.id}/retry`, {
      method: "POST",
    }).catch(ignoreBackgroundRequestError);
    setIsRetrying(false);

    if (!response?.ok) {
      return;
    }

    await refreshLectureDetail({ force: true });
  }

  useEffect(() => {
    void refreshLectureDetail({ force: true });
  }, [refreshLectureDetail]);

  async function handleStudyCreate() {
    setStudyError(null);
    setIsAwaitingStudyGeneration(true);
    setIsRegeneratingStudy(true);

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/study`, {
        method: "POST",
      });
      await parseApiResponse<{ ok: true }>(response);
    } catch (error) {
      if (redirectToBillingIfNeeded({ error, router })) {
        return;
      }

      setIsAwaitingStudyGeneration(false);
      setStudyError(getRequestErrorMessage(error, "Učnih orodij ni bilo mogoče ponovno ustvariti."));
      return;
    } finally {
      setIsRegeneratingStudy(false);
    }

    await refreshLectureDetail();
  }

  async function handleQuizCreate() {
    setStudyError(null);
    setIsAwaitingQuizGeneration(true);
    setIsRegeneratingQuiz(true);

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/quiz`, {
        method: "POST",
      });
      await parseApiResponse<{ ok: true }>(response);
    } catch (error) {
      if (redirectToBillingIfNeeded({ error, router })) {
        return;
      }

      setIsAwaitingQuizGeneration(false);
      setStudyError(getRequestErrorMessage(error, "Kviza ni bilo mogoče ustvariti."));
      return;
    } finally {
      setIsRegeneratingQuiz(false);
    }

    await refreshLectureDetail();
  }

  async function handlePracticeTestStart() {
    setStudyError(null);
    setIsAwaitingPracticeTestGeneration(true);
    setIsStartingPracticeTest(true);

    let payload: {
      id?: string;
      questions?: Array<{ id: string }>;
    };

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/practice-test/attempt`, {
        method: "POST",
      });
      payload = await parseApiResponse(response);
    } catch (error) {
      if (redirectToBillingIfNeeded({ error, router })) {
        return;
      }

      setIsAwaitingPracticeTestGeneration(false);
      setStudyError(
        getRequestErrorMessage(error, "Novega preizkusa ni bilo mogoče začeti."),
      );
      return;
    } finally {
      setIsStartingPracticeTest(false);
    }

    setCurrentPracticeAttemptId(payload?.id ?? null);
    setPracticeAttemptQuestionIds(
      Array.isArray(payload?.questions) ? payload.questions.map((question: { id: string }) => question.id) : [],
    );
    setPracticeTextAnswers({});
    setPracticeUnknownQuestionIds([]);
    setLatestViewedPracticeAttemptId(payload?.id ?? null);
    setPracticeSubmittedAt(null);
    await refreshLectureDetail();
  }

  function handlePracticeAnswerChange(questionId: string, value: string) {
    setPracticeTextAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  }

  function handlePracticeUnknownToggle(questionId: string, enabled: boolean) {
    setPracticeUnknownQuestionIds((current) => {
      if (enabled) {
        return current.includes(questionId) ? current : [...current, questionId];
      }

      return current.filter((id) => id !== questionId);
    });

    if (enabled) {
      setPracticeTextAnswers((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
    }
  }

  function getFlashcardDragThreshold(width: number) {
    return Math.min(
      FLASHCARD_DRAG_TRIGGER_MAX_PX,
      Math.max(FLASHCARD_DRAG_TRIGGER_MIN_PX, width * FLASHCARD_DRAG_TRIGGER_RATIO),
    );
  }

  function getFlashcardDragRotation(deltaX: number, width: number) {
    if (width <= 0) {
      return 0;
    }

    const ratio = Math.max(-1, Math.min(1, deltaX / width));
    return ratio * FLASHCARD_DRAG_MAX_ROTATION_DEG;
  }

  function getFlashcardExitStart(deltaX: number, deltaY: number, width: number): FlashcardExitStart {
    const safeWidth = Math.max(width, 1);

    return {
      xPercent: (deltaX / safeWidth) * 100,
      yPercent: (deltaY / safeWidth) * 100,
      rotationDeg: getFlashcardDragRotation(deltaX, safeWidth),
    };
  }

  function resetFlashcardDrag() {
    flashcardDragSessionRef.current = null;
    setFlashcardDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
  }

  function suppressNextFlashcardClick(durationMs = 700) {
    suppressNextFlashcardClickRef.current = true;

    if (suppressNextFlashcardClickTimerRef.current) {
      window.clearTimeout(suppressNextFlashcardClickTimerRef.current);
    }

    suppressNextFlashcardClickTimerRef.current = window.setTimeout(() => {
      suppressNextFlashcardClickRef.current = false;
      suppressNextFlashcardClickTimerRef.current = null;
    }, durationMs);
  }

  function clearNextFlashcardClickSuppression() {
    suppressNextFlashcardClickRef.current = false;

    if (suppressNextFlashcardClickTimerRef.current) {
      window.clearTimeout(suppressNextFlashcardClickTimerRef.current);
      suppressNextFlashcardClickTimerRef.current = null;
    }
  }

  function handleFlashcardPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      flashcardExitAnimation ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    flashcardDragSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already cancelled the pointer.
    }
  }

  function handleFlashcardPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = flashcardDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaX = event.clientX - session.startX;
    const rawDeltaY = event.clientY - session.startY;
    const hasIntent = Math.abs(rawDeltaX) > 4 || Math.abs(rawDeltaY) > 4;

    if (!hasIntent) {
      return;
    }

    if (Math.abs(rawDeltaX) > 8) {
      suppressNextFlashcardClick();
    }

    const maxDrag = session.width * 0.56;
    const deltaX = Math.max(-maxDrag, Math.min(maxDrag, rawDeltaX));
    const deltaY = Math.max(-42, Math.min(42, rawDeltaY * 0.18));

    setFlashcardDrag({
      isDragging: true,
      deltaX,
      deltaY,
      width: session.width,
    });
  }

  function handleFlashcardPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = flashcardDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaX = event.clientX - session.startX;
    const rawDeltaY = event.clientY - session.startY;
    const maxDrag = session.width * 0.56;
    const deltaX = Math.max(-maxDrag, Math.min(maxDrag, rawDeltaX));
    const deltaY = Math.max(-42, Math.min(42, rawDeltaY * 0.18));
    const threshold = getFlashcardDragThreshold(session.width);
    const shouldSubmit = Math.abs(deltaX) >= threshold;
    const bucket: FlashcardConfidenceBucket = deltaX < 0 ? "again" : "easy";

    if (Math.abs(rawDeltaX) > 8 || Math.abs(rawDeltaY) > 8) {
      suppressNextFlashcardClick();
    }

    resetFlashcardDrag();

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }

    if (shouldSubmit) {
      suppressNextFlashcardClick();
      void handleFlashcardProgress(bucket, {
        exitStart: getFlashcardExitStart(deltaX, deltaY, session.width),
      });
    }
  }

  function handleFlashcardClick() {
    if (suppressNextFlashcardClickRef.current) {
      clearNextFlashcardClickSuppression();
      return;
    }

    setIsFlashcardFlipped((current) => !current);
  }

  async function handlePracticeTestSubmit() {
    if (!currentPracticeAttempt) {
      return;
    }

    const answers = currentPracticeAttempt.answers.map((answer) => {
      const questionId = answer.practice_test_question_id ?? `snapshot-${answer.id}`;
      return {
        answerId: answer.id,
        typedAnswer: practiceTextAnswers[questionId] ?? "",
        declaredUnknown: practiceUnknownQuestionIds.includes(questionId),
      };
    });

    setStudyError(null);
    setIsSubmittingPracticeTest(true);
    let response: Response;
    let payload: { error?: string } | null = null;
    try {
      response = await fetch(
        `/api/lectures/${detail.lecture.id}/practice-test/attempt/${currentPracticeAttempt.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ answers }),
        },
      );
      payload = (await response.json().catch(() => null)) as { error?: string } | null;
    } catch (error) {
      setStudyError(getRequestErrorMessage(error, "Preizkusa ni bilo mogoče oddati."));
      return;
    } finally {
      setIsSubmittingPracticeTest(false);
    }

    if (!response.ok) {
      setStudyError(payload?.error ?? "Preizkusa ni bilo mogoče oddati.");
      return;
    }

    const submittedAt = new Date().toISOString();
    setPracticeSubmittedAt(submittedAt);
    setLatestViewedPracticeAttemptId(currentPracticeAttempt.id);
    await refreshLectureDetail();
  }

  async function handleFlashcardProgress(
    confidenceBucket: FlashcardConfidenceBucket,
    options?: { exitStart?: FlashcardExitStart },
  ) {
    const currentFlashcardId = reviewQueue[activeFlashcardIndex];
    const flashcard = studyDeck.find((item) => item.id === currentFlashcardId);
    if (!flashcard) {
      return;
    }

    setStudyError(null);
    const isLastCardInRound = activeFlashcardIndex >= reviewQueue.length - 1;
    const previousDetail = detail;
    const previousReviewQueue = reviewQueue;
    const previousRepeatQueue = repeatQueue;
    const previousActiveFlashcardIndex = activeFlashcardIndex;
    const previousRoundSummary = flashcardRoundSummary;
    const previousResults = flashcardSessionResults[flashcard.id];
    const previousProgress = flashcard.progress;
    const wasFlashcardFlipped = isFlashcardFlipped;
    const nextRepeatQueue =
      confidenceBucket === "again"
        ? Array.from(new Set([...repeatQueue, flashcard.id]))
        : repeatQueue.filter((id) => id !== flashcard.id);
    flashcardFeedbackTokenRef.current += 1;
    const feedbackToken = flashcardFeedbackTokenRef.current;
    const nextProgress = {
      ...(previousProgress ?? {
        user_id: detail.lecture.user_id,
        flashcard_id: flashcard.id,
        confidence_bucket: confidenceBucket,
        review_count: 0,
        last_reviewed_at: null,
      }),
      confidence_bucket: confidenceBucket,
      review_count: (previousProgress?.review_count ?? 0) + 1,
      last_reviewed_at: new Date().toISOString(),
    };

    if (flashcardFeedbackTimerRef.current) {
      window.clearTimeout(flashcardFeedbackTimerRef.current);
    }

    setFlashcardExitAnimation({
      flashcard,
      bucket: confidenceBucket,
      flipped: wasFlashcardFlipped,
      token: feedbackToken,
      startXPercent: options?.exitStart?.xPercent ?? 0,
      startYPercent: options?.exitStart?.yPercent ?? 0,
      startRotationDeg: options?.exitStart?.rotationDeg ?? 0,
    });
    setIsFlashcardFlipped(false);
    flashcardFeedbackTimerRef.current = window.setTimeout(() => {
      setFlashcardExitAnimation((current) =>
        current?.token === feedbackToken ? null : current,
      );
      flashcardFeedbackTimerRef.current = null;
    }, FLASHCARD_EXIT_ANIMATION_MS);

    setDetail((current) => ({
      ...current,
      studySections: current.studySections.map((section) => {
        const matchesSection = isLegacySectionId(section.id)
          ? !flashcard.section_id
          : section.id === flashcard.section_id;

        if (!matchesSection) {
          return section;
        }

        const wasReviewed = (flashcard.progress?.review_count ?? 0) > 0;
        const nextReviewedCount = wasReviewed
          ? section.reviewedCount
          : Math.min(section.reviewedCount + 1, section.card_count);
        return {
          ...section,
          reviewedCount: nextReviewedCount,
          completed: nextReviewedCount >= section.card_count,
        };
      }),
      flashcards: current.flashcards.map((currentFlashcard) =>
        currentFlashcard.id === flashcard.id
          ? {
              ...currentFlashcard,
              progress: nextProgress,
            }
          : currentFlashcard,
      ),
    }));
    setFlashcardSessionResults((current) => {
      const previous = current[flashcard.id];

      return {
        ...current,
        [flashcard.id]: {
          attempts: (previous?.attempts ?? 0) + 1,
          firstConfidence: previous?.firstConfidence ?? confidenceBucket,
          latestConfidence: confidenceBucket,
        },
      };
    });

    setRepeatQueue(nextRepeatQueue);

    if (isLastCardInRound) {
      setFlashcardRoundSummary({
        cycle: reviewCycle,
        total: cycleCardCount,
        known: cycleCardCount - nextRepeatQueue.length,
        missed: nextRepeatQueue.length,
      });
    } else {
      setActiveFlashcardIndex((current) => Math.min(current + 1, reviewQueue.length - 1));
    }

    let response: Response;
    let payload: FlashcardProgressResponse | null = null;
    try {
      response = await fetch(`/api/flashcards/${flashcard.id}/progress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confidenceBucket }),
      });
      payload = (await response.json().catch(() => null)) as FlashcardProgressResponse | null;
    } catch (error) {
      setDetail(previousDetail);
      setFlashcardSessionResults((current) => {
        const next = { ...current };

        if (previousResults) {
          next[flashcard.id] = previousResults;
        } else {
          delete next[flashcard.id];
        }

        return next;
      });
      setReviewQueue(previousReviewQueue);
      setRepeatQueue(previousRepeatQueue);
      setActiveFlashcardIndex(previousActiveFlashcardIndex);
      setFlashcardRoundSummary(previousRoundSummary);
      setStudyError(getRequestErrorMessage(error, "Napredka pri karticah ni bilo mogoče shraniti."));
      return;
    }

    if (!response.ok) {
      setDetail(previousDetail);
      setFlashcardSessionResults((current) => {
        const next = { ...current };

        if (previousResults) {
          next[flashcard.id] = previousResults;
        } else {
          delete next[flashcard.id];
        }

        return next;
      });
      setReviewQueue(previousReviewQueue);
      setRepeatQueue(previousRepeatQueue);
      setActiveFlashcardIndex(previousActiveFlashcardIndex);
      setFlashcardRoundSummary(previousRoundSummary);
      setStudyError(payload?.error ?? "Napredka pri karticah ni bilo mogoče shraniti.");
      return;
    }

    const savedProgress = payload?.progress;
    if (savedProgress) {
      setDetail((current) => ({
        ...current,
        flashcards: current.flashcards.map((currentFlashcard) =>
          currentFlashcard.id === flashcard.id
            ? {
                ...currentFlashcard,
                progress: savedProgress,
              }
            : currentFlashcard,
        ),
      }));
    }
  }

  function continueFlashcardReview(nextRepeatQueue = repeatQueue) {
    if (nextRepeatQueue.length === 0) {
      return;
    }

    const repeatIds = new Set(nextRepeatQueue);
    setReviewQueue(nextRepeatQueue);
    setRepeatQueue([]);
    setActiveFlashcardIndex(0);
    setReviewCycle((current) => current + 1);
    setCycleCardCount(nextRepeatQueue.length);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(null);
    setFlashcardSessionResults((current) =>
      Object.fromEntries(Object.entries(current).filter(([flashcardId]) => !repeatIds.has(flashcardId))),
    );
    setStudyError(null);
  }

  function restartFlashcardReview() {
    const initialQueue = studyDeck.map((flashcard) => flashcard.id);
    setReviewQueue(initialQueue);
    setRepeatQueue([]);
    setActiveFlashcardIndex(0);
    setReviewCycle(1);
    setCycleCardCount(initialQueue.length);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(null);
    setFlashcardSessionResults({});
    setStudyError(null);
  }

  function handleFlashcardNavigate(direction: "previous" | "next") {
    if (flashcardExitAnimation) {
      return;
    }

    if (
      direction === "next" &&
      currentReviewFlashcardId &&
      !flashcardSessionResults[currentReviewFlashcardId]
    ) {
      void handleFlashcardProgress("again");
      return;
    }

    setIsFlashcardFlipped(false);
    setStudyError(null);
    setActiveFlashcardIndex((current) => {
      if (direction === "previous") {
        return Math.max(0, current - 1);
      }

      return Math.min(reviewQueue.length - 1, current + 1);
    });
  }

  function handleQuizSelection(optionIndex: number) {
    if (!activeQuizQuestion || !currentQuizQuestionId) {
      return;
    }

    setQuizSelections((current) => {
      if (typeof current[currentQuizQuestionId] === "number") {
        return current;
      }

      return {
        ...current,
        [currentQuizQuestionId]: optionIndex,
      };
    });
  }

  function finishQuizRound() {
    const summary = quizQueue.reduce<QuizRoundSummary>(
      (current, questionId) => {
        const question = quizQuestionsById.get(questionId);

        if (!question) {
          return current;
        }

        if (quizSelections[questionId] === question.correct_option_idx) {
          current.correct += 1;
          return current;
        }

        current.missed += 1;
        current.missedQuestionIds.push(questionId);
        return current;
      },
      {
        cycle: quizRound,
        total: quizRoundCount,
        correct: 0,
        missed: 0,
        missedQuestionIds: [],
      },
    );

    setQuizRoundSummary(summary);
  }

  function moveQuizQuestion(direction: -1 | 1) {
    const nextIndex = activeQuizQuestionIndex + direction;

    if (direction === 1 && nextIndex >= quizQueue.length) {
      finishQuizRound();
      return;
    }

    setActiveQuizQuestionIndex(
      Math.max(0, Math.min(nextIndex, Math.max(quizQueue.length - 1, 0))),
    );
  }

  function continueQuizReview() {
    if (!quizRoundSummary || quizRoundSummary.missedQuestionIds.length === 0) {
      return;
    }

    setQuizQueue(quizRoundSummary.missedQuestionIds);
    setQuizRound((current) => current + 1);
    setQuizRoundCount(quizRoundSummary.missedQuestionIds.length);
    setQuizRoundSummary(null);
    setActiveQuizQuestionIndex(0);
    setQuizSelections({});
    setQuizOptionOrders(buildQuizOptionOrders(quizRoundSummary.missedQuestionIds, quizQuestionsById));
    setStudyError(null);
  }

  function restartQuiz() {
    const initialQueue = quizDeckKey ? quizDeckKey.split("|") : [];
    setQuizQueue(initialQueue);
    setQuizRound(1);
    setQuizRoundCount(initialQueue.length);
    setQuizRoundSummary(null);
    setActiveQuizQuestionIndex(0);
    setQuizSelections({});
    setQuizOptionOrders(buildQuizOptionOrders(initialQueue, quizQuestionsById));
    setStudyError(null);
  }

  async function submitChatQuestion() {
    if (!question.trim() || chatLimitReached) {
      return;
    }

    const tempUserMessage: ChatMessageWithCitations = {
      id: `temp-user-${Date.now()}`,
      lecture_id: detail.lecture.id,
      user_id: "me",
      role: "user",
      content: question.trim(),
      citations: [],
      created_at: new Date().toISOString(),
    };

    setDetail((current) => ({
      ...current,
      chatMessages: [...current.chatMessages, tempUserMessage],
    }));
    setIsSending(true);
    setChatError(null);
    const currentQuestion = question.trim();
    setQuestion("");

    let response: Response;
    let payload: ChatResponse | null = null;
    try {
      response = await fetch(`/api/lectures/${detail.lecture.id}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
        }),
      });
      payload = (await response.json().catch(() => null)) as ChatResponse | null;
    } catch (error) {
      setChatError(getRequestErrorMessage(error, "Odgovora ni bilo mogoče ustvariti."));
      setDetail((current) => ({
        ...current,
        chatMessages: current.chatMessages.filter(
          (message) => message.id !== tempUserMessage.id,
        ),
      }));
      return;
    } finally {
      setIsSending(false);
    }

    if (!response.ok) {
      if (payload?.code === "trial_chat_limit_reached") {
        setTrialChatMessagesRemaining(0);
      }

      setChatError(payload?.error ?? "Odgovora ni bilo mogoče ustvariti.");
      setDetail((current) => ({
        ...current,
        chatMessages: current.chatMessages.filter(
          (message) => message.id !== tempUserMessage.id,
        ),
      }));
      return;
    }

    const chatAnswer = payload?.answer;
    if (!chatAnswer) {
      setChatError("Odgovora ni bilo mogoče ustvariti.");
      setDetail((current) => ({
        ...current,
        chatMessages: current.chatMessages.filter(
          (message) => message.id !== tempUserMessage.id,
        ),
      }));
      return;
    }

    setDetail((current) => ({
      ...current,
      chatMessages: [
        ...current.chatMessages.filter((message) => message.id !== tempUserMessage.id),
        tempUserMessage,
        chatAnswer,
      ],
    }));

    if (isTrialLecture) {
      setTrialChatMessagesRemaining((current) => Math.max(current - 1, 0));
    }
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitChatQuestion();
  }

  function handleChatKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (!question.trim() || detail.lecture.status !== "ready" || isSending || chatLimitReached) {
      return;
    }

    void submitChatQuestion();
  }

  function renderPanel() {
    if (activeTab === "notes") {
      return (
        <div className="workspace-panel-stack lecture-panel-stack">
          <div className="ios-card lecture-notes-card">
            {cleanedStructuredNotes && detail.lecture.status === "ready" ? (
              <div className="markdown lecture-markdown">
                <NoteReadAloud lectureId={detail.lecture.id} content={cleanedStructuredNotes} />
              </div>
            ) : shouldPollLecture(detail.lecture.status) || notesArtifactLoadFailed ? (
              <div className="lecture-notes-processing">
                <StudyGenerationNotice
                  stageCopy={notesArtifactLoadFailed ? "Nalaganje zapiskov" : lectureProcessingStageCopy}
                  bodyCopy={
                    notesArtifactLoadFailed
                      ? "Zapiski so pripravljeni, vendar se niso naložili v tem poskusu. Poskušamo znova."
                      : "Obdelava teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut."
                  }
                />
              </div>
            ) : (
              <p className="ios-info">Zapiski še niso pripravljeni.</p>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === "study") {
      const currentFlashcard = studyDeck.find((flashcard) => flashcard.id === currentReviewFlashcardId) ?? null;
      const currentFlashcardDisplayIndex = currentFlashcard ? activeFlashcardIndex + 1 : 0;
      const currentFlashcardDisplayTotal = reviewQueue.length || totalFlashcards;
      const currentFlashcardAnswer =
        currentFlashcard ? flashcardSessionResults[currentFlashcard.id]?.latestConfidence ?? null : null;
      const currentFlashcardAnswerLabel =
        currentFlashcardAnswer == null
          ? null
          : currentFlashcardAnswer === "again"
            ? "Nisem vedel"
            : "Vedel sem";
      const currentFlashcardAnswerClass =
        currentFlashcardAnswer == null
          ? "unanswered"
          : currentFlashcardAnswer === "again"
            ? "again"
            : "easy";
      const flashcardKnownCount = reviewQueue.reduce((total, flashcardId) => {
        const answer = flashcardSessionResults[flashcardId]?.latestConfidence;
        return answer && answer !== "again" ? total + 1 : total;
      }, 0);
      const flashcardMissedCount = reviewQueue.reduce((total, flashcardId) => {
        return flashcardSessionResults[flashcardId]?.latestConfidence === "again" ? total + 1 : total;
      }, 0);
      const visibleFlashcardRepeatQueue =
        repeatQueue.length > 0
          ? repeatQueue
          : reviewQueue.filter(
              (flashcardId) => flashcardSessionResults[flashcardId]?.latestConfidence === "again",
            );
      const derivedFlashcardRoundSummary =
        !flashcardRoundSummary &&
        reviewQueue.length > 0 &&
        reviewQueue.every((flashcardId) => flashcardSessionResults[flashcardId]?.latestConfidence)
          ? {
              cycle: reviewCycle,
              total: cycleCardCount || reviewQueue.length,
              known: flashcardKnownCount,
              missed: flashcardMissedCount,
            }
          : null;
      const visibleFlashcardRoundSummary = flashcardRoundSummary ?? derivedFlashcardRoundSummary;
      const visibleFlashcardRoundPercent =
        visibleFlashcardRoundSummary && visibleFlashcardRoundSummary.total > 0
          ? Math.round((visibleFlashcardRoundSummary.known / visibleFlashcardRoundSummary.total) * 100)
          : 0;
      const canNavigateFlashcard =
        !!currentFlashcard &&
        !flashcardExitAnimation &&
        !visibleFlashcardRoundSummary;
      const canNavigatePreviousFlashcard = canNavigateFlashcard && activeFlashcardIndex > 0;
      const canNavigateNextFlashcard =
        canNavigateFlashcard && activeFlashcardIndex < reviewQueue.length - 1;
      const flashcardDragThreshold = getFlashcardDragThreshold(flashcardDrag.width);
      const flashcardDragProgress =
        flashcardDragThreshold > 0
          ? Math.min(1, Math.abs(flashcardDrag.deltaX) / flashcardDragThreshold)
          : 0;
      const flashcardDragDirection =
        Math.abs(flashcardDrag.deltaX) > 4
          ? flashcardDrag.deltaX < 0
            ? "again"
            : "easy"
          : null;
      const flashcardDragStyle = {
        "--lecture-flashcard-drag-x": `${flashcardDrag.deltaX}px`,
        "--lecture-flashcard-drag-y": `${flashcardDrag.deltaY}px`,
        "--lecture-flashcard-drag-rotation": `${getFlashcardDragRotation(
          flashcardDrag.deltaX,
          flashcardDrag.width,
        )}deg`,
        "--lecture-flashcard-drag-progress": flashcardDragProgress,
      } as CSSProperties;
      const shouldAutoSizeStudyShell =
        activeStudyView === "flashcards" ||
        activeStudyView === "quiz" ||
        activeStudyView === "practice_test";
      const activeMaterialError =
        activeStudyView === "flashcards"
          ? detail.studyAsset?.error_message
          : activeStudyView === "quiz"
            ? detail.quizAsset?.error_message
            : detail.practiceTestAsset?.error_message;

      return (
        <div className="workspace-panel-stack lecture-panel-stack">
          <div
            className={`ios-card lecture-study-shell ${shouldAutoSizeStudyShell ? "auto-height" : ""}`}
          >
            <div className="lecture-study-header">
              <div className="lecture-study-title">
                {activeMaterialStatus && activeMaterialStatusLabel ? (
                  <div className="lecture-study-meta">
                    <span className={`lecture-study-status ${activeMaterialStatus}`}>
                      {activeMaterialStatusLabel}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="lecture-study-header-actions">
                {activeStudyView === "practice_test" ? (
                  <span className="lecture-study-status demo">Demo</span>
                ) : null}
              </div>
            </div>

            <div className="ios-segmented lecture-study-mode-switch">
              {([
                { id: "flashcards", label: "Flashcards" },
                { id: "quiz", label: "Kviz" },
                { id: "practice_test", label: "Test" },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveStudyView(item.id)}
                  className={`ios-segment ${activeStudyView === item.id ? "active" : ""}`}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {studyError ? <p className="danger-panel lecture-inline-note">{studyError}</p> : null}
            {activeMaterialError ? (
              <p className="danger-panel lecture-inline-note">{activeMaterialError}</p>
            ) : null}

            {activeStudyView === "flashcards" ? (
              totalFlashcards === 0 ? (
                <div className="empty-state lecture-empty-card lecture-study-empty">
                  {!isStudyGenerating ? (
                    <>
                      <p className="ios-row-title">
                        {detail.lecture.status !== "ready"
                          ? "Učna orodja se odklenejo, ko je obdelava zapiska končana."
                          : detail.studyAsset?.status === "failed"
                            ? "Ustvarjanje kartic ni uspelo."
                            : "Ustvari kartice, ko si pripravljen."}
                      </p>
                      <p className="ios-row-subtitle">
                        {detail.lecture.status !== "ready"
                          ? "Najprej nastanejo zapiski. Nato lahko kartice ustvariš ročno."
                          : "Ustvari učni komplet v istem jeziku in iz iste vsebine kot tvoji zapiski."}
                      </p>
                    </>
                  ) : null}
                  {detail.lecture.status === "ready" && !isStudyGenerating ? (
                    <button
                      type="button"
                      onClick={() => void handleStudyCreate()}
                      disabled={isRegeneratingStudy}
                      className="lecture-study-refresh lecture-study-create-button"
                    >
                      {isRegeneratingStudy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Ustvari kartice
                    </button>
                  ) : null}
                  {isStudyGenerating ? (
                    <StudyGenerationNotice stageCopy={studyStageCopy} />
                  ) : null}
                </div>
            ) : visibleFlashcardRoundSummary ? (
                <StudyCompletionCard
                  eyebrow={
                    visibleFlashcardRoundSummary.missed === 0
                      ? "Zaključeno"
                      : `Krog ${visibleFlashcardRoundSummary.cycle} zaključen`
                  }
                  title={
                    visibleFlashcardRoundSummary.missed === 0
                      ? "Vse kartice so predelane"
                      : "Ponovi kartice, ki si jih zgrešil"
                  }
                  percentage={visibleFlashcardRoundSummary.missed === 0 ? 100 : visibleFlashcardRoundPercent}
                  percentageLabel={visibleFlashcardRoundSummary.missed === 0 ? "Komplet opravljen" : "Rezultat kroga"}
                  primaryMetric={{
                    label: "Pravilno v tem krogu",
                    value: `${visibleFlashcardRoundSummary.known}/${visibleFlashcardRoundSummary.total}`,
                  }}
                  actions={
                    visibleFlashcardRoundSummary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restartFlashcardReview}
                        className="lecture-study-refresh lecture-study-restart"
                        aria-label="Začni znova"
                        title="Začni znova"
                      >
                        <EmojiIcon symbol="🔄" size="1rem" />
                        Začni komplet znova
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => continueFlashcardReview(visibleFlashcardRepeatQueue)}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <EmojiIcon symbol="🔄" size="1rem" />
                        Ponovi {visibleFlashcardRoundSummary.missed}{" "}
                        {visibleFlashcardRoundSummary.missed === 1 ? "zgrešeno kartico" : "zgrešene kartice"}
                      </button>
                    )
                  }
                />
            ) : currentFlashcard ? (
                <>
                  <div className="lecture-flashcard-stage">
                    <div className="lecture-flashcard-stage-card">
                      <button
                        type="button"
                        className={`lecture-flashcard ${isFlashcardFlipped ? "flipped" : ""} ${
                          flashcardDrag.isDragging ? "dragging" : ""
                        } ${flashcardDragDirection ? `drag-${flashcardDragDirection}` : ""}`}
                        style={flashcardDragStyle}
                        onClick={handleFlashcardClick}
                        onPointerDown={handleFlashcardPointerDown}
                        onPointerMove={handleFlashcardPointerMove}
                        onPointerUp={handleFlashcardPointerEnd}
                        onPointerCancel={resetFlashcardDrag}
                      >
                        <div className="lecture-flashcard-rotator">
                          <div className="lecture-flashcard-face lecture-flashcard-face-front">
                            <div className="lecture-flashcard-face-header">
                              <span>{currentFlashcardDisplayIndex} / {currentFlashcardDisplayTotal}</span>
                              {currentFlashcardAnswerLabel ? (
                                <span className={`lecture-flashcard-answer-label ${currentFlashcardAnswerClass}`}>
                                  {currentFlashcardAnswerLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="lecture-flashcard-content">{currentFlashcard.front}</p>
                            <span className="lecture-flashcard-side-label">Pokaži odgovor</span>
                          </div>
                          <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                            <div className="lecture-flashcard-face-header">
                              <span>{currentFlashcardDisplayIndex} / {currentFlashcardDisplayTotal}</span>
                              {currentFlashcardAnswerLabel ? (
                                <span className={`lecture-flashcard-answer-label ${currentFlashcardAnswerClass}`}>
                                  {currentFlashcardAnswerLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="lecture-flashcard-content">{currentFlashcard.back}</p>
                            <span className="lecture-flashcard-side-label">Nazaj na vprašanje</span>
                          </div>
                        </div>
                        <div className="lecture-flashcard-drag-overlay" aria-hidden="true">
                          <EmojiIcon
                            symbol={flashcardDragDirection === "again" ? "❌" : "✅"}
                            size="2.25rem"
                          />
                        </div>
                      </button>
                      {flashcardExitAnimation ? (
                        <div
                          key={flashcardExitAnimation.token}
                          className={`lecture-flashcard-exit-card ${flashcardExitAnimation.bucket} ${
                            flashcardExitAnimation.flipped ? "flipped" : ""
                          }`}
                          style={
                            {
                              "--lecture-flashcard-exit-start-x": `${flashcardExitAnimation.startXPercent}%`,
                              "--lecture-flashcard-exit-start-y": `${flashcardExitAnimation.startYPercent}%`,
                              "--lecture-flashcard-exit-start-rotation": `${flashcardExitAnimation.startRotationDeg}deg`,
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        >
                          <div className="lecture-flashcard-rotator">
                            <div className="lecture-flashcard-face lecture-flashcard-face-front">
                              <div className="lecture-flashcard-exit-blank" />
                            </div>
                            <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                              <div className="lecture-flashcard-exit-blank" />
                            </div>
                          </div>
                          <div className="lecture-flashcard-exit-overlay">
                            {flashcardExitAnimation.bucket === "again" ? (
                              <EmojiIcon symbol="❌" size="2.25rem" />
                            ) : (
                              <EmojiIcon symbol="✅" size="2.25rem" />
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="lecture-flashcard-toolbar">
                    <div className="lecture-flashcard-review">
                      <button
                        type="button"
                        onClick={() => handleFlashcardNavigate("previous")}
                        disabled={!canNavigatePreviousFlashcard}
                        className="lecture-flashcard-nav-button previous"
                        aria-label="Prejšnja kartica"
                        title="Prejšnja kartica"
                      >
                        <ArrowLeft aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleFlashcardProgress("again")}
                        className={`lecture-flashcard-review-button again ${
                          currentFlashcardAnswer === "again" ? "selected" : ""
                        }`}
                        aria-label={confidenceLabel("again")}
                        title={confidenceLabel("again")}
                      >
                        <X aria-hidden="true" />
                        <span>{flashcardMissedCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleFlashcardProgress("easy")}
                        className={`lecture-flashcard-review-button easy ${
                          currentFlashcardAnswer && currentFlashcardAnswer !== "again" ? "selected" : ""
                        }`}
                        aria-label={confidenceLabel("easy")}
                        title={confidenceLabel("easy")}
                      >
                        <span>{flashcardKnownCount}</span>
                        <Check aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFlashcardNavigate("next")}
                        disabled={!canNavigateNextFlashcard}
                        className="lecture-flashcard-nav-button next"
                        aria-label="Naslednja kartica"
                        title="Naslednja kartica"
                      >
                        <ArrowRight aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <StudyCompletionCard
                  eyebrow="Zaključeno"
                  title="Učenje s karticami je končano"
                  percentage={flashcardConfidencePercent}
                  percentageLabel="Rezultat"
                  primaryMetric={{
                    label: "Pravilni odgovori",
                    value: `${flashcardFirstPassKnownCount}/${totalFlashcards}`,
                  }}
                  actions={
                    <button
                      type="button"
                      onClick={restartFlashcardReview}
                      className="lecture-study-refresh lecture-study-restart"
                      aria-label="Začni znova"
                      title="Začni znova"
                    >
                      <EmojiIcon symbol="🔄" size="1rem" />
                      Začni komplet znova
                    </button>
                  }
                />
              )
            ) : activeStudyView === "quiz" ? (
              totalQuizQuestions === 0 ? (
                <div className="empty-state lecture-empty-card lecture-study-empty">
                  {!isQuizGenerating ? (
                    <>
                      <p className="ios-row-title">
                        {detail.lecture.status !== "ready"
                          ? "Učna orodja se odklenejo, ko je obdelava zapiska končana."
                          : detail.quizAsset?.status === "failed"
                            ? "Ustvarjanje kviza ni uspelo."
                            : "Ustvari kviz, ko si pripravljen."}
                      </p>
                      <p className="ios-row-subtitle">
                        {detail.lecture.status !== "ready"
                          ? "Najprej nastanejo zapiski. Nato lahko kvize ustvariš ročno."
                          : "Ustvari vprašanja z več izbirami v istem jeziku kot tvoji zapiski."}
                      </p>
                    </>
                  ) : null}
                  {detail.lecture.status === "ready" && !isQuizGenerating ? (
                    <button
                      type="button"
                      onClick={() => void handleQuizCreate()}
                      disabled={isRegeneratingQuiz}
                      className="lecture-study-refresh lecture-study-create-button"
                    >
                      {isRegeneratingQuiz ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Ustvari kviz
                    </button>
                  ) : null}
                  {isQuizGenerating ? (
                    <StudyGenerationNotice stageCopy={quizStageCopy} />
                  ) : null}
                </div>
              ) : quizRoundSummary ? (
                <StudyCompletionCard
                  eyebrow={
                    quizRoundSummary.missed === 0
                      ? "Zaključeno"
                      : `Krog ${quizRoundSummary.cycle} zaključen`
                  }
                  title={
                    quizRoundSummary.missed === 0
                      ? "Vsa vprašanja so predelana"
                      : "Ponovi vprašanja, ki si jih zgrešil"
                  }
                  percentage={quizRoundSummary.missed === 0 ? 100 : quizRoundPercent}
                  percentageLabel={quizRoundSummary.missed === 0 ? "Komplet opravljen" : "Rezultat kroga"}
                  primaryMetric={{
                    label: quizRoundSummary.missed === 0 ? "Predelana vprašanja" : "Pravilno v tem krogu",
                    value:
                      quizRoundSummary.missed === 0
                        ? `${totalQuizQuestions}/${totalQuizQuestions}`
                        : `${quizRoundSummary.correct}/${quizRoundSummary.total}`,
                  }}
                  actions={
                    quizRoundSummary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restartQuiz}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <EmojiIcon symbol="🔄" size="1rem" />
                        Začni kviz znova
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={continueQuizReview}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <EmojiIcon symbol="🔄" size="1rem" />
                        Ponovi {quizRoundSummary.missed}{" "}
                        {quizRoundSummary.missed === 1 ? "zgrešeno vprašanje" : "zgrešena vprašanja"}
                      </button>
                    )
                  }
                />
              ) : activeQuizQuestion ? (
                <div className="lecture-quiz-stage">
                  <div className="lecture-quiz-meta">
                    <span>{activeQuizQuestionIndex + 1} / {quizRoundCount}</span>
                    {quizRound > 1 ? <span>Krog {quizRound}</span> : null}
                  </div>

                  <div className="lecture-quiz-card">
                    <p className="lecture-quiz-prompt">{activeQuizQuestion.prompt}</p>

                    <div className="lecture-quiz-options">
                      {activeQuizOptionOrder.map((optionIndex, displayIndex) => {
                        const option = activeQuizQuestion.options[optionIndex] ?? "";
                        const isSelected = activeQuizSelection === optionIndex;
                        const isCorrect =
                          activeQuizSelection !== null &&
                          optionIndex === activeQuizQuestion.correct_option_idx;
                        const isIncorrect =
                          activeQuizSelection !== null &&
                          isSelected &&
                          optionIndex !== activeQuizQuestion.correct_option_idx;

                        return (
                          <button
                            key={`${activeQuizQuestion.id}-${optionIndex}`}
                            type="button"
                            onClick={() => handleQuizSelection(optionIndex)}
                            disabled={activeQuizSelection !== null}
                            className={`lecture-quiz-option ${isSelected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isIncorrect ? "incorrect" : ""}`}
                          >
                            <span className="lecture-quiz-option-label">
                              {String.fromCharCode(65 + displayIndex)}
                            </span>
                            <span className="lecture-quiz-option-copy">{option}</span>
                          </button>
                        );
                      })}
                    </div>

                    {activeQuizSelection !== null ? (
                      <div className="lecture-quiz-feedback">
                        <p
                          className={`lecture-quiz-feedback-title ${
                            activeQuizSelection === activeQuizQuestion.correct_option_idx
                              ? "correct"
                              : "incorrect"
                          }`}
                        >
                          {activeQuizSelection === activeQuizQuestion.correct_option_idx
                            ? "Pravilno"
                            : "Napačno"}
                        </p>
                        <p className="lecture-quiz-feedback-copy">{activeQuizQuestion.explanation}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="lecture-quiz-actions">
                    <button
                      type="button"
                      onClick={() => moveQuizQuestion(-1)}
                      disabled={activeQuizQuestionIndex === 0}
                      className="lecture-study-action"
                    >
                      Nazaj
                    </button>
                    <button
                      type="button"
                      onClick={() => moveQuizQuestion(1)}
                      disabled={activeQuizSelection === null}
                      className="lecture-study-refresh"
                    >
                      {activeQuizQuestionIndex === quizQueue.length - 1 ? "Zaključi" : "Naprej"}
                    </button>
                  </div>
                </div>
              ) : (
                <StudyCompletionCard
                  eyebrow="Odlično"
                  title="Kviz je zaključen"
                  percentage={100}
                  percentageLabel="Komplet opravljen"
                  primaryMetric={{
                    label: "Predelana vprašanja",
                    value: `${totalQuizQuestions}/${totalQuizQuestions}`,
                  }}
                  actions={
                    <button
                      type="button"
                      onClick={restartQuiz}
                      className="lecture-study-refresh lecture-study-restart"
                    >
                      <EmojiIcon symbol="🔄" size="1rem" />
                      Začni kviz znova
                    </button>
                  }
                />
              )
            ) : detail.practiceTestQuestions.length === 0 ? (
              <div className="empty-state lecture-empty-card lecture-study-empty">
                {!isPracticeTestGenerating ? (
                  <>
                    <p className="ios-row-title">
                      {detail.lecture.status !== "ready"
                        ? "Učna orodja se odklenejo, ko je obdelava zapiska končana."
                        : detail.practiceTestAsset?.status === "failed"
                          ? "Ustvarjanje preizkusa ni uspelo."
                          : hasCompletedPracticeTest
                            ? "Začni nov preizkus, ko si pripravljen."
                            : "Ustvari svoj prvi preizkus."}
                    </p>
                    <p className="ios-row-subtitle">
                      {detail.lecture.status !== "ready"
                        ? "Najprej nastanejo zapiski. Nato lahko začneš preizkus."
                        : hasCompletedPracticeTest
                          ? "Vsak nov preizkus prinese nov naključen nabor odprtih vprašanj."
                          : "Najprej ustvari prvi nabor samostojnih odprtih vprašanj, nato preglej rezultate in po koncu začni nove preizkuse."}
                    </p>
                  </>
                ) : null}
                {detail.lecture.status === "ready" && !isPracticeTestGenerating ? (
                  <button
                    type="button"
                    onClick={() => void handlePracticeTestStart()}
                    disabled={isStartingPracticeTest}
                    className="lecture-study-refresh lecture-study-create-button"
                  >
                    {isStartingPracticeTest ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {hasCompletedPracticeTest ? "Začni nov preizkus" : "Ustvari preizkus"}
                  </button>
                ) : null}
                {isPracticeTestGenerating ? (
                  <StudyGenerationNotice stageCopy={practiceTestStageCopy} />
                ) : null}
              </div>
            ) : currentPracticeAttempt ? (
              <div className="lecture-practice-shell">
                <div className="lecture-practice-list">
                  {practiceAttemptAnswers.map((answer, index) => {
                    const question = answer.question;
                    const questionId = answer.practice_test_question_id ?? `snapshot-${answer.id}`;
                    const isUnknown = practiceUnknownQuestionIds.includes(questionId);

                    return (
                      <div key={answer.id} className="lecture-practice-card">
                        <div className="lecture-practice-card-header">
                          <span>Vprašanje {index + 1}</span>
                        </div>
                        <p className="lecture-practice-prompt">{question?.prompt ?? "Vprašanje ni na voljo."}</p>
                        <textarea
                          value={practiceTextAnswers[questionId] ?? ""}
                          onChange={(event) => handlePracticeAnswerChange(questionId, event.target.value)}
                          disabled={isUnknown}
                          className="ios-textarea lecture-practice-textarea"
                          placeholder="Sem napiši svoj odgovor..."
                        />
                        <div className="lecture-practice-controls">
                          <label className="lecture-practice-unknown">
                            <input
                              type="checkbox"
                              checked={isUnknown}
                              onChange={(event) =>
                                handlePracticeUnknownToggle(questionId, event.target.checked)
                              }
                            />
                            Ne vem
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="lecture-practice-submit">
                  <button
                    type="button"
                    onClick={() => void handlePracticeTestSubmit()}
                    disabled={
                      isSubmittingPracticeTest ||
                      practiceQuestionsAnsweredCount < practiceAttemptAnswers.length
                    }
                    className="lecture-study-refresh"
                  >
                    {isSubmittingPracticeTest ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Oddaj preizkus
                  </button>
                </div>
              </div>
            ) : (
              <div className="lecture-practice-shell">
                {visiblePracticeAttempt && visiblePracticeAttempt.status === "graded" ? (
                  <div className="lecture-practice-results">
                    <StudyCompletionCard
                      eyebrow=""
                      title=""
                      subtitle={`Poskus ${detail.practiceTestHistorySummary.attemptCount}`}
                      percentage={visiblePracticeAttemptPercentage}
                      percentageLabel="Rezultat"
                      primaryMetric={{
                        label: "Dosežene točke",
                        value: `${visiblePracticeAttempt.total_score ?? 0}/${visiblePracticeAttempt.max_score ?? 0}`,
                      }}
                      secondaryMetrics={[
                        {
                          label: "Povprečje",
                          value:
                            detail.practiceTestHistorySummary.averagePercentage == null
                              ? "-"
                              : `${Math.round(detail.practiceTestHistorySummary.averagePercentage)}%`,
                        },
                        {
                          label: "Najboljši rezultat",
                          value:
                            detail.practiceTestHistorySummary.bestPercentage == null
                              ? "-"
                              : `${Math.round(detail.practiceTestHistorySummary.bestPercentage)}%`,
                        },
                        {
                          label: "Najnižji rezultat",
                          value:
                            detail.practiceTestHistorySummary.lowestPercentage == null
                              ? "-"
                              : `${Math.round(detail.practiceTestHistorySummary.lowestPercentage)}%`,
                        },
                        {
                          label: "Poskusi",
                          value: String(detail.practiceTestHistorySummary.attemptCount),
                        },
                      ]}
                      actions={
                        !isPracticeTestGenerating ? (
                          <button
                            type="button"
                            onClick={() => void handlePracticeTestStart()}
                            disabled={isStartingPracticeTest}
                            className="lecture-study-refresh lecture-practice-start-button"
                          >
                            {isStartingPracticeTest ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : null}
                            Začni nov preizkus
                          </button>
                        ) : null
                      }
                    />

                    <details className="lecture-practice-breakdown">
                      <summary>
                        <span className="lecture-practice-breakdown-icon" aria-hidden="true">
                          📝
                        </span>
                        <span className="lecture-practice-breakdown-label">Podrobnosti poskusa</span>
                        <span className="lecture-practice-breakdown-chevron" aria-hidden="true">
                          ▾
                        </span>
                      </summary>
                      <div className="lecture-practice-feedback-list">
                        {visiblePracticeAttempt.answers.map((answer, index) => (
                          <details key={answer.id} className="lecture-practice-feedback-card">
                            <summary className="lecture-practice-feedback-summary">
                              <span className="lecture-practice-feedback-label">
                                Vprašanje {index + 1}
                              </span>
                              <span className="lecture-practice-feedback-meta">
                                <span>{answer.score ?? 0}/5</span>
                                <span
                                  className="lecture-practice-feedback-chevron"
                                  aria-hidden="true"
                                >
                                  ▾
                                </span>
                              </span>
                            </summary>
                            <div className="lecture-practice-feedback-body">
                              <p className="lecture-practice-prompt">{answer.question?.prompt}</p>
                              {answer.typed_answer ? (
                                <p className="lecture-practice-feedback-copy">
                                  <strong>Tvoj odgovor:</strong> {answer.typed_answer}
                                </p>
                              ) : null}
                              <p className="lecture-practice-feedback-copy">
                                <strong>Razlaga:</strong> {answer.grading_rationale ?? "Brez povratne informacije."}
                              </p>
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="lecture-practice-summary lecture-practice-summary-centered">
                    <div className="lecture-practice-summary-actions">
                      {!isPracticeTestGenerating ? (
                        <button
                          type="button"
                          onClick={() => void handlePracticeTestStart()}
                          disabled={isStartingPracticeTest}
                          className="lecture-study-refresh lecture-practice-start-button"
                        >
                          {isStartingPracticeTest ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                          Začni nov preizkus
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === "chat") {
      return (
        <div className="ios-card lecture-chat-shell">
          <div ref={chatScrollRef} className="lecture-chat-scroll">
            <div className="chat-thread lecture-chat-thread">
              {detail.chatMessages.length > 0 ? (
                <>
                  {detail.chatMessages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}
                  {isSending ? (
                    <div className="lecture-chat-message assistant">
                      <div className="lecture-chat-bubble lecture-chat-bubble-loading">
                        <span className="lecture-chat-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="lecture-chat-empty">
                  <p className="lecture-chat-empty-title">Vprašaj o tem predavanju.</p>
                  <p className="lecture-chat-empty-copy">
                    {showsTranscript
                      ? "Kot kontekst uporabi zapiske in prepis."
                      : "Kot kontekst uporabi zapiske."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleChatSubmit} className="lecture-chat-composer">
            <div className="lecture-chat-composer-row">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleChatKeyDown}
                disabled={detail.lecture.status !== "ready" || isSending || chatLimitReached}
                className="lecture-chat-input"
                placeholder="Vprašaj o tem predavanju"
                rows={1}
              />
              <button
                type="submit"
                disabled={detail.lecture.status !== "ready" || isSending || chatLimitReached}
                className="lecture-chat-send"
                aria-label="Pošlji sporočilo"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
            <div className="lecture-chat-composer-footer">
              {chatError ? (
                <p className="lecture-chat-status ios-danger">{chatError}</p>
              ) : detail.lecture.status !== "ready" ? (
                <p className="lecture-chat-status">Na voljo bo po koncu obdelave.</p>
              ) : chatLimitReached ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="lecture-chat-status ios-danger">Porabil si vseh 5 brezplačnih sporočil.</p>
                  <button
                    type="button"
                    className="ios-secondary-button"
                    onClick={() => router.push("/app/start")}
                  >
                    Nadgradi
                  </button>
                </div>
              ) : isTrialLecture ? (
                <p className="lecture-chat-status">
                  Brezplačna sporočila za ta zapisek: {trialChatMessagesRemaining}/5.
                </p>
              ) : (
                <p className="lecture-chat-status">Odgovori ostajajo vezani na to predavanje.</p>
              )}
            </div>
          </form>
        </div>
      );
    }

    if (activeTab === "transcript") {
      const transcriptSegments =
        detail.transcript.length > 0 ? detail.transcript : getScanTranscriptFallback(detail);
      const isScanTranscript = isScanImport(detail);

      return transcriptSegments.length > 0 ? (
        <div
          className={`ios-card lecture-transcript-card ${
            isScanTranscript ? "lecture-transcript-card-scan" : ""
          }`}
        >
          {transcriptSegments.map((segment) => (
            <div key={segment.id} className="timeline-row">
              <p className="timeline-time">
                {isScanTranscript ? (
                  formatScanTranscriptLabel(segment.speaker_label)
                ) : (
                  <>
                    {formatTimestamp(segment.start_ms)}
                    {segment.end_ms > segment.start_ms
                      ? ` - ${formatTimestamp(segment.end_ms)}`
                      : ""}
                    {segment.speaker_label ? ` · ${segment.speaker_label}` : ""}
                  </>
                )}
              </p>
              <p className="lecture-transcript-text m-0 whitespace-pre-wrap text-[0.98rem] leading-8 text-[var(--label)]">
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="ios-card empty-state lecture-empty-card">
          <p className="ios-row-title">Prepis se še pripravlja.</p>
          <p className="ios-row-subtitle">Ko bo pripravljen, se bo prikazal tukaj.</p>
        </div>
      );
    }

    return (
      <div className="ios-card audio-panel">
        <p className="lecture-card-label">Zvok</p>
        {detail.audioUrl ? (
          <audio controls src={detail.audioUrl} className="mt-4 w-full" />
        ) : (
          <div className="empty-state lecture-empty-card">
            <p className="ios-row-title">Zvok še ni na voljo.</p>
            <p className="ios-row-subtitle">Prikazal se bo po koncu nalaganja.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="lecture-workspace lecture-workspace-full">
      <div className="workspace-panel-stack lecture-main-column">
        <div className="lecture-header">
          <div className="lecture-header-row">
            <div className="ios-title-block lecture-title-block">
              <h1 className="ios-large-title">
                {detail.lecture.title ?? "Predavanje v obdelavi"}
              </h1>
              <div className="lecture-meta-row">
                <span className="lecture-meta-pill">
                  {sourceLabel(getEffectiveLectureSourceType(detail.lecture))}
                </span>
                <span className="lecture-meta-copy">{formatCalendarDate(detail.lecture.created_at)}</span>
              </div>
            </div>

            <div className="lecture-actions">
              {detail.lecture.status === "failed" ? (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="lecture-action-button lecture-action-button-danger"
                >
                  {isRetrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <EmojiIcon symbol="🔄" size="1rem" />
                  )}
                  Poskusi znova
                </button>
              ) : null}
            </div>
          </div>

          {detail.lecture.error_message ? (
            <p className="danger-panel lecture-inline-note">{detail.lecture.error_message}</p>
          ) : null}

          {shouldPollLecture(detail.lecture.status) ||
          (detail.flashcards.length === 0 && shouldPollAsset(detail.studyAsset?.status)) ||
          shouldPollAsset(detail.quizAsset?.status) ||
          shouldPollAsset(detail.practiceTestAsset?.status) ? (
            <p className="ios-info lecture-inline-note">
              Obdelava še poteka. Ta pogled se samodejno osvežuje.
            </p>
          ) : null}
        </div>

        <div className="ios-segmented lecture-segmented">
          {getTabItems({
            hasAudio: Boolean(detail.audioUrl),
            showsTranscript,
          }).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`ios-segment lecture-tab-button ${activeTab === tab.id ? "active" : ""}`}
              aria-label={tab.label}
              title={tab.label}
            >
              <span className="lecture-tab-button-content">
                <EmojiIcon symbol={tab.icon} size="1rem" />
                <span className="lecture-tab-button-label">{tab.label}</span>
              </span>
            </button>
          ))}
        </div>

        {renderPanel()}
      </div>
    </div>
  );
}
