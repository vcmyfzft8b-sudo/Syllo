"use client";

import {
  Brain,
  Check,
  Download,
  FileAudio2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  ScrollText,
  Send,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { StatusBadge } from "@/components/status-badge";
import { StudyCompletionCard } from "@/components/study-completion-card";
import type { FlashcardConfidenceBucket, StudyAssetStatus } from "@/lib/database.types";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import type {
  ChatMessageWithCitations,
  LectureDetail,
  PersistedFlashcardSessionState,
  PersistedQuizSessionState,
  QuizQuestionWithOptions,
} from "@/lib/types";
import {
  formatCalendarDate,
  formatTimestamp,
} from "@/lib/utils";

type WorkspaceTab = "notes" | "study" | "chat" | "transcript" | "audio";
type StudyMaterialView = "flashcards" | "quiz";
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
};

type QuizRoundSummary = {
  cycle: number;
  total: number;
  correct: number;
  missed: number;
  missedQuestionIds: string[];
};

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
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "notes", label: "Notes", icon: FileText },
    { id: "study", label: "Study", icon: Brain },
    { id: "chat", label: "Chat", icon: MessageSquareText },
  ];

  if (showsTranscript) {
    items.push({ id: "transcript", label: "Transcript", icon: ScrollText });
  }

  if (hasAudio) {
    items.push({ id: "audio", label: "Audio", icon: FileAudio2 });
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

  if (shouldPollAsset(detail.studyAsset?.status) || shouldPollAsset(detail.quizAsset?.status)) {
    return true;
  }

  if (detail.studyAsset?.status === "ready" && detail.flashcards.length === 0) {
    return true;
  }

  if (detail.quizAsset?.status === "ready" && detail.quizQuestions.length === 0) {
    return true;
  }

  return false;
}

function confidenceLabel(value: FlashcardConfidenceBucket) {
  if (value === "again") {
    return "Didn't know";
  }
  return "Knew it";
}

function confidenceIcon(value: FlashcardConfidenceBucket) {
  return value === "again" ? X : Check;
}

const FLASHCARD_EXIT_ANIMATION_MS = 770;

function normalizeHeadingText(value: string) {
  return value
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingRedundantHeading(markdown: string, title?: string | null) {
  const lines = markdown.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return markdown;
  }

  const match = lines[firstContentIndex].match(/^#{1,6}\s+(.+)$/);
  if (!match) {
    return markdown;
  }

  const heading = normalizeHeadingText(match[1] ?? "");
  const normalizedTitle = normalizeHeadingText(title ?? "");
  const genericHeadings = new Set(["notes", "lecture notes", "structured notes"]);

  if (!genericHeadings.has(heading) && heading !== normalizedTitle) {
    return markdown;
  }

  const remainingLines = lines.slice(firstContentIndex + 1);

  while (remainingLines[0]?.trim() === "") {
    remainingLines.shift();
  }

  return remainingLines.join("\n").trim();
}

function sanitizeFileName(value?: string | null) {
  return value?.replace(/[\\/:*?"<>|]+/g, "").trim() || "note";
}

function sourceLabel(sourceType: string) {
  if (sourceType === "link") {
    return "Web link";
  }

  if (sourceType === "text") {
    return "Text";
  }

  if (sourceType === "pdf") {
    return "PDF document";
  }

  return "Audio recording";
}

function studyStageLabel(stage: unknown) {
  if (stage === "building_sections") {
    return "Building study sections";
  }

  if (stage === "planning_coverage") {
    return "Extracting concepts";
  }

  if (stage === "generating_cards") {
    return "Generating cards";
  }

  if (stage === "repairing_coverage") {
    return "Repairing gaps";
  }

  if (stage === "publishing_deck") {
    return "Validating coverage";
  }

  return "Preparing study tools";
}

function quizStageLabel(stage: unknown) {
  if (stage === "generating_questions") {
    return "Generating quiz";
  }

  if (stage === "publishing_quiz") {
    return "Publishing quiz";
  }

  if (stage === "ready") {
    return "Quiz ready";
  }

  return "Preparing quiz";
}

function studyAssetStatusLabel(status: StudyAssetStatus | null | undefined) {
  if (status === "queued") {
    return "Preparing";
  }

  if (status === "generating") {
    return "Generating";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "ready") {
    return "Ready";
  }

  return null;
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

  if (detail.flashcards.length > 0) {
    return "flashcards";
  }

  if (detail.quizQuestions.length > 0) {
    return "quiz";
  }

  return "flashcards";
}

function buildDefaultFlashcardSessionState(
  flashcardIds: string[],
): PersistedFlashcardSessionState {
  return {
    reviewQueue: flashcardIds,
    repeatQueue: [],
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

  const reviewQueue = session.reviewQueue.filter((id) => validIds.has(id));
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

  if (flashcardIds.length > 0 && reviewQueue.length === 0 && !roundSummary) {
    return fallback;
  }

  return {
    reviewQueue,
    repeatQueue,
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
}: {
  initialDetail: LectureDetail;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("notes");
  const [question, setQuestion] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isRegeneratingStudy, setIsRegeneratingStudy] = useState(false);
  const [isRegeneratingQuiz, setIsRegeneratingQuiz] = useState(false);
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
  const [reviewQueue, setReviewQueue] = useState<string[]>(initialFlashcardSession.reviewQueue);
  const [repeatQueue, setRepeatQueue] = useState<string[]>(initialFlashcardSession.repeatQueue);
  const [reviewCycle, setReviewCycle] = useState(initialFlashcardSession.reviewCycle);
  const [cycleCardCount, setCycleCardCount] = useState(initialFlashcardSession.cycleCardCount);
  const [activeProgressFlashcardId, setActiveProgressFlashcardId] = useState<string | null>(null);
  const [flashcardRoundSummary, setFlashcardRoundSummary] = useState<FlashcardRoundSummary | null>(
    initialFlashcardSession.roundSummary,
  );
  const [flashcardExitAnimation, setFlashcardExitAnimation] = useState<FlashcardExitAnimation | null>(
    null,
  );
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
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const flashcardFeedbackTimerRef = useRef<number | null>(null);
  const flashcardFeedbackTokenRef = useRef(0);
  const studyDeck = detail.flashcards;
  const flashcardDeckKey = studyDeck.map((flashcard) => flashcard.id).join("|");
  const quizDeckKey = detail.quizQuestions.map((question) => question.id).join("|");
  const quizQuestionsById = useMemo(
    () => new Map(detail.quizQuestions.map((question) => [question.id, question])),
    [detail.quizQuestions],
  );
  const currentReviewFlashcardId = reviewQueue[0] ?? null;
  const showsTranscript = detail.lecture.source_type === "audio";
  const shouldPollCurrentDetail = shouldPollDetail(detail);

  useEffect(() => {
    setDetail(initialDetail);
    setActiveStudyView(getInitialStudyView(initialDetail));
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
    if (!shouldPollCurrentDetail) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const response = await fetch(`/api/lectures/${detail.lecture.id}`);
      if (!response.ok || cancelled) {
        return;
      }

      const nextDetail = (await response.json()) as LectureDetail;
      if (!cancelled) {
        setDetail(nextDetail);
      }
    };

    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    const handleFocus = () => {
      void refresh();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    detail.flashcards.length,
    detail.lecture.id,
    detail.lecture.status,
    detail.quizAsset?.status,
    detail.quizQuestions.length,
    detail.studyAsset?.status,
    shouldPollCurrentDetail,
  ]);

  useEffect(() => {
    setIsFlashcardFlipped(false);
  }, [activeTab, currentReviewFlashcardId]);

  useEffect(() => {
    const flashcardIds = flashcardDeckKey ? flashcardDeckKey.split("|") : [];
    const nextState = sanitizeFlashcardSessionState(
      detail.studySession?.flashcard_state,
      flashcardIds,
    );

    setReviewQueue(nextState.reviewQueue);
    setRepeatQueue(nextState.repeatQueue);
    setReviewCycle(nextState.reviewCycle);
    setCycleCardCount(nextState.cycleCardCount);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(nextState.roundSummary);
    setFlashcardSessionResults(nextState.sessionResults);
    setFlashcardExitAnimation(null);
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
    return () => {
      if (flashcardFeedbackTimerRef.current) {
        window.clearTimeout(flashcardFeedbackTimerRef.current);
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
    const timeoutId = window.setTimeout(() => {
      const flashcardState: PersistedFlashcardSessionState | null =
        studyDeck.length > 0
          ? {
              reviewQueue,
              repeatQueue,
              reviewCycle,
              cycleCardCount,
              roundSummary: flashcardRoundSummary,
              sessionResults: flashcardSessionResults,
            }
          : null;
      const quizState: PersistedQuizSessionState | null =
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
          : null;

      void fetch(`/api/lectures/${detail.lecture.id}/study-session`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activeStudyView,
          flashcardState,
          quizState,
        }),
      });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeQuizQuestionIndex,
    activeStudyView,
    cycleCardCount,
    detail.lecture.id,
    detail.quizQuestions.length,
    flashcardRoundSummary,
    flashcardSessionResults,
    quizOptionOrders,
    quizQueue,
    quizRound,
    quizRoundCount,
    quizRoundSummary,
    quizSelections,
    repeatQueue,
    reviewCycle,
    reviewQueue,
    studyDeck.length,
  ]);

  const cleanedStructuredNotes = useMemo(() => {
    if (!detail.artifact?.structured_notes_md) {
      return null;
    }

    return stripLeadingRedundantHeading(
      detail.artifact.structured_notes_md,
      detail.lecture.title,
    );
  }, [detail.artifact?.structured_notes_md, detail.lecture.title]);
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
  const totalFlashcards = studyDeck.length;
  const flashcardFirstPassKnownCount = studyDeck.reduce((total, flashcard) => {
    return flashcardSessionResults[flashcard.id]?.firstConfidence !== "again" &&
      flashcardSessionResults[flashcard.id]?.firstConfidence
      ? total + 1
      : total;
  }, 0);
  const flashcardConfidencePercent =
    totalFlashcards > 0 ? Math.round((flashcardFirstPassKnownCount / totalFlashcards) * 100) : 0;
  const flashcardRoundPercent =
    flashcardRoundSummary && flashcardRoundSummary.total > 0
      ? Math.round((flashcardRoundSummary.known / flashcardRoundSummary.total) * 100)
      : 0;
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
  const activeMaterialStatus =
    activeStudyView === "flashcards" ? detail.studyAsset?.status : detail.quizAsset?.status;
  const activeMaterialStatusLabel = studyAssetStatusLabel(activeMaterialStatus);

  async function handleRetry() {
    setIsRetrying(true);
    const response = await fetch(`/api/lectures/${detail.lecture.id}/retry`, {
      method: "POST",
    });
    setIsRetrying(false);

    if (!response.ok) {
      return;
    }

    const refresh = await fetch(`/api/lectures/${detail.lecture.id}`);
    if (refresh.ok) {
      setDetail((await refresh.json()) as LectureDetail);
    }
  }

  async function refreshLectureDetail() {
    const refresh = await fetch(`/api/lectures/${detail.lecture.id}`);
    if (refresh.ok) {
      setDetail((await refresh.json()) as LectureDetail);
    }
  }

  async function handleStudyCreate() {
    setStudyError(null);
    setIsRegeneratingStudy(true);
    const response = await fetch(`/api/lectures/${detail.lecture.id}/study`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    setIsRegeneratingStudy(false);

    if (!response.ok) {
      setStudyError(payload?.error ?? "Study tools could not be regenerated.");
      return;
    }

    await refreshLectureDetail();
  }

  async function handleQuizCreate() {
    setStudyError(null);
    setIsRegeneratingQuiz(true);
    const response = await fetch(`/api/lectures/${detail.lecture.id}/quiz`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    setIsRegeneratingQuiz(false);

    if (!response.ok) {
      setStudyError(payload?.error ?? "Quiz could not be created.");
      return;
    }

    await refreshLectureDetail();
  }

  async function handleFlashcardProgress(confidenceBucket: FlashcardConfidenceBucket) {
    const currentFlashcardId = reviewQueue[0];
    const flashcard = studyDeck.find((item) => item.id === currentFlashcardId);
    if (!flashcard) {
      return;
    }

    setStudyError(null);
    setActiveProgressFlashcardId(flashcard.id);
    const isLastCardInRound = reviewQueue.length === 1;
    const nextMissedCount = confidenceBucket === "again" ? repeatQueue.length + 1 : repeatQueue.length;
    const previousDetail = detail;
    const previousReviewQueue = reviewQueue;
    const previousRepeatQueue = repeatQueue;
    const previousRoundSummary = flashcardRoundSummary;
    const previousResults = flashcardSessionResults[flashcard.id];
    const previousProgress = flashcard.progress;
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
      flipped: isFlashcardFlipped,
      token: feedbackToken,
    });
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

    setReviewQueue((current) => {
      const [activeId, ...remaining] = current;
      return activeId === flashcard.id ? remaining : current;
    });

    if (confidenceBucket === "again") {
      setRepeatQueue((current) => [...current, flashcard.id]);
    }

    if (isLastCardInRound) {
      setFlashcardRoundSummary({
        cycle: reviewCycle,
        total: cycleCardCount,
        known: cycleCardCount - nextMissedCount,
        missed: nextMissedCount,
      });
    }

    const response = await fetch(`/api/flashcards/${flashcard.id}/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confidenceBucket }),
    });

    const payload = await response.json().catch(() => null);
    setActiveProgressFlashcardId(null);

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
      setFlashcardRoundSummary(previousRoundSummary);
      setStudyError(payload?.error ?? "Flashcard progress could not be saved.");
      return;
    }

    if (payload?.progress) {
      setDetail((current) => ({
        ...current,
        flashcards: current.flashcards.map((currentFlashcard) =>
          currentFlashcard.id === flashcard.id
            ? {
                ...currentFlashcard,
                progress: payload.progress,
              }
            : currentFlashcard,
        ),
      }));
    }
  }

  function continueFlashcardReview() {
    if (repeatQueue.length === 0) {
      return;
    }

    setReviewQueue(repeatQueue);
    setRepeatQueue([]);
    setReviewCycle((current) => current + 1);
    setCycleCardCount(repeatQueue.length);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(null);
    setStudyError(null);
  }

  function restartFlashcardReview() {
    const initialQueue = studyDeck.map((flashcard) => flashcard.id);
    setReviewQueue(initialQueue);
    setRepeatQueue([]);
    setReviewCycle(1);
    setCycleCardCount(initialQueue.length);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(null);
    setFlashcardSessionResults({});
    setStudyError(null);
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
    if (!question.trim()) {
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

    const response = await fetch(`/api/lectures/${detail.lecture.id}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: currentQuestion,
      }),
    });

    const payload = await response.json();
    setIsSending(false);

    if (!response.ok) {
      setChatError(payload.error ?? "The answer could not be generated.");
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
        payload.answer as ChatMessageWithCitations,
      ],
    }));
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

    if (!question.trim() || detail.lecture.status !== "ready" || isSending) {
      return;
    }

    void submitChatQuestion();
  }

  async function downloadPdf() {
    if (!detail.artifact) {
      return;
    }

    setIsExportingPdf(true);

    const anchor = document.createElement("a");
    anchor.href = `/api/lectures/${detail.lecture.id}/pdf`;
    anchor.download = `${sanitizeFileName(detail.lecture.title)}.pdf`;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => {
      setIsExportingPdf(false);
    }, 800);
  }

  function renderPanel() {
    if (activeTab === "notes") {
      return (
        <div className="workspace-panel-stack lecture-panel-stack">
          <div className="ios-card lecture-notes-card">
            <div className="markdown lecture-markdown">
              {cleanedStructuredNotes ? (
                <MarkdownRenderer content={cleanedStructuredNotes} />
              ) : (
                <p className="ios-info">Notes are not ready yet.</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "study") {
      const currentFlashcard = studyDeck.find((flashcard) => flashcard.id === currentReviewFlashcardId) ?? null;
      const flashcardsCompleted = totalFlashcards > 0 && currentFlashcard === null;
      const shouldAutoSizeStudyShell =
        activeStudyView === "quiz" || (activeStudyView === "flashcards" && flashcardsCompleted);
      const activeMaterialError =
        activeStudyView === "flashcards"
          ? detail.studyAsset?.error_message
          : detail.quizAsset?.error_message;

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
            </div>

            <div className="ios-segmented lecture-study-mode-switch">
              {([
                { id: "flashcards", label: "Flashcards" },
                { id: "quiz", label: "Quiz" },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveStudyView(item.id)}
                  className={`ios-segment ${activeStudyView === item.id ? "active" : ""}`}
                >
                  {item.label}
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
                  <p className="ios-row-title">
                    {detail.lecture.status !== "ready"
                      ? "Study tools unlock after note processing finishes."
                      : shouldPollAsset(detail.studyAsset?.status)
                        ? "Creating flashcards."
                        : detail.studyAsset?.status === "failed"
                          ? "Flashcard creation failed."
                          : "Create flashcards when you're ready."}
                  </p>
                  <p className="ios-row-subtitle">
                    {detail.lecture.status !== "ready"
                      ? "Notes are created first. After that, you can generate flashcards manually."
                      : shouldPollAsset(detail.studyAsset?.status)
                        ? "This view refreshes automatically as your deck is prepared."
                        : "Build a study deck from the same language and content as your notes."}
                  </p>
                  {detail.lecture.status === "ready" && !shouldPollAsset(detail.studyAsset?.status) ? (
                    <button
                      type="button"
                      onClick={() => void handleStudyCreate()}
                      disabled={isRegeneratingStudy}
                      className="lecture-study-refresh lecture-study-create-button"
                    >
                      {isRegeneratingStudy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Create flashcards
                    </button>
                  ) : null}
                  {shouldPollAsset(detail.studyAsset?.status) ? (
                    <p className="lecture-study-hint">{studyStageCopy}</p>
                  ) : null}
                </div>
            ) : currentFlashcard ? (
                <>
                  <div className="lecture-flashcard-stage">
                    <div className="lecture-flashcard-stage-meta">
                      <span>
                        {Math.max(
                          1,
                          studyDeck.findIndex((flashcard) => flashcard.id === currentFlashcard.id) + 1,
                        )}{" "}
                        / {totalFlashcards}
                      </span>
                    </div>
                    <div className="lecture-flashcard-stage-card">
                      <button
                        type="button"
                        className={`lecture-flashcard ${isFlashcardFlipped ? "flipped" : ""}`}
                        onClick={() => setIsFlashcardFlipped((current) => !current)}
                      >
                        <div className="lecture-flashcard-rotator">
                          <div className="lecture-flashcard-face lecture-flashcard-face-front">
                            <div className="lecture-flashcard-face-meta">
                              <span>Flashcard</span>
                            </div>
                            <p className="lecture-flashcard-content">{currentFlashcard.front}</p>
                          </div>
                          <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                            <div className="lecture-flashcard-face-meta">
                              <span>Answer</span>
                            </div>
                            <p className="lecture-flashcard-content">{currentFlashcard.back}</p>
                            {currentFlashcard.hint ? (
                              <p className="lecture-flashcard-hintline">{currentFlashcard.hint}</p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                      {flashcardExitAnimation ? (
                        <div
                          key={flashcardExitAnimation.token}
                          className={`lecture-flashcard-exit-card ${flashcardExitAnimation.bucket} ${
                            flashcardExitAnimation.flipped ? "flipped" : ""
                          }`}
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
                              <X className="h-9 w-9" />
                            ) : (
                              <Check className="h-9 w-9" />
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="lecture-flashcard-toolbar">
                    {isFlashcardFlipped ? (
                      <div className="lecture-flashcard-review">
                        {(["again", "easy"] as const).map((bucket) => {
                          const Icon = confidenceIcon(bucket);

                          return (
                            <button
                              key={bucket}
                              type="button"
                              onClick={() => void handleFlashcardProgress(bucket)}
                              disabled={activeProgressFlashcardId === currentFlashcard.id}
                              className={`lecture-flashcard-review-button ${bucket}`}
                              aria-label={confidenceLabel(bucket)}
                              title={confidenceLabel(bucket)}
                            >
                              {activeProgressFlashcardId === currentFlashcard.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Icon className="h-5 w-5" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : flashcardRoundSummary ? (
                <StudyCompletionCard
                  eyebrow={
                    flashcardRoundSummary.missed === 0
                      ? "Completed"
                      : `Round ${flashcardRoundSummary.cycle} complete`
                  }
                  title={
                    flashcardRoundSummary.missed === 0
                      ? "All flashcards cleared"
                      : "Review the ones you missed"
                  }
                  percentage={flashcardRoundSummary.missed === 0 ? 100 : flashcardRoundPercent}
                  percentageLabel={flashcardRoundSummary.missed === 0 ? "Deck cleared" : "Round score"}
                  primaryMetric={{
                    label: "Knew this round",
                    value: `${flashcardRoundSummary.known}/${flashcardRoundSummary.total}`,
                  }}
                  actions={
                    flashcardRoundSummary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restartFlashcardReview}
                        className="lecture-study-refresh lecture-study-restart"
                        aria-label="Start over"
                        title="Start over"
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Restart deck
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={continueFlashcardReview}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Review {flashcardRoundSummary.missed}{" "}
                        {flashcardRoundSummary.missed === 1 ? "missed card" : "missed cards"}
                      </button>
                    )
                  }
                />
              ) : (
                <StudyCompletionCard
                  eyebrow="Completed"
                  title="Flashcard session complete"
                  percentage={flashcardConfidencePercent}
                  percentageLabel="Score"
                  primaryMetric={{
                    label: "Correct answers",
                    value: `${flashcardFirstPassKnownCount}/${totalFlashcards}`,
                  }}
                  actions={
                    <button
                      type="button"
                      onClick={restartFlashcardReview}
                      className="lecture-study-refresh lecture-study-restart"
                      aria-label="Start over"
                      title="Start over"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Restart deck
                    </button>
                  }
                />
              )
            ) : totalQuizQuestions === 0 ? (
              <div className="empty-state lecture-empty-card lecture-study-empty">
                <p className="ios-row-title">
                  {detail.lecture.status !== "ready"
                    ? "Study tools unlock after note processing finishes."
                    : shouldPollAsset(detail.quizAsset?.status)
                      ? "Creating quiz."
                      : detail.quizAsset?.status === "failed"
                        ? "Quiz creation failed."
                        : "Create a quiz when you're ready."}
                </p>
                <p className="ios-row-subtitle">
                  {detail.lecture.status !== "ready"
                    ? "Notes are created first. After that, you can generate quizzes manually."
                    : shouldPollAsset(detail.quizAsset?.status)
                      ? "This view refreshes automatically as your quiz is prepared."
                      : "Generate multiple-choice questions in the same language as your notes."}
                </p>
                {detail.lecture.status === "ready" && !shouldPollAsset(detail.quizAsset?.status) ? (
                  <button
                    type="button"
                    onClick={() => void handleQuizCreate()}
                    disabled={isRegeneratingQuiz}
                    className="lecture-study-refresh lecture-study-create-button"
                  >
                    {isRegeneratingQuiz ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Create quiz
                  </button>
                ) : null}
                {shouldPollAsset(detail.quizAsset?.status) ? (
                  <p className="lecture-study-hint">{quizStageCopy}</p>
                ) : null}
              </div>
            ) : quizRoundSummary ? (
              <StudyCompletionCard
                eyebrow={
                  quizRoundSummary.missed === 0
                    ? "Completed"
                    : `Round ${quizRoundSummary.cycle} complete`
                }
                title={
                  quizRoundSummary.missed === 0
                    ? "All quiz questions cleared"
                    : "Review the questions you missed"
                }
                percentage={quizRoundSummary.missed === 0 ? 100 : quizRoundPercent}
                percentageLabel={quizRoundSummary.missed === 0 ? "Deck cleared" : "Round score"}
                primaryMetric={{
                  label: quizRoundSummary.missed === 0 ? "Questions cleared" : "Correct this round",
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
                      <RefreshCcw className="h-4 w-4" />
                      Restart quiz
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={continueQuizReview}
                      className="lecture-study-refresh lecture-study-restart"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Review {quizRoundSummary.missed}{" "}
                      {quizRoundSummary.missed === 1 ? "missed question" : "missed questions"}
                    </button>
                  )
                }
              />
            ) : activeQuizQuestion ? (
              <div className="lecture-quiz-stage">
                <div className="lecture-quiz-meta">
                  <span>{activeQuizQuestionIndex + 1} / {quizRoundCount}</span>
                  {quizRound > 1 ? <span>Cycle {quizRound}</span> : null}
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
                          ? "Correct"
                          : "Incorrect"}
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
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQuizQuestion(1)}
                    disabled={activeQuizSelection === null}
                    className="lecture-study-refresh"
                  >
                    {activeQuizQuestionIndex === quizQueue.length - 1 ? "Finish" : "Next"}
                  </button>
                </div>
              </div>
            ) : (
              <StudyCompletionCard
                eyebrow="Congratulations"
                title="Quiz complete"
                percentage={100}
                percentageLabel="Deck cleared"
                primaryMetric={{
                  label: "Questions cleared",
                  value: `${totalQuizQuestions}/${totalQuizQuestions}`,
                }}
                actions={
                  <button
                    type="button"
                    onClick={restartQuiz}
                    className="lecture-study-refresh lecture-study-restart"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Restart quiz
                  </button>
                }
              />
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
                  <p className="lecture-chat-empty-title">Ask about this lecture.</p>
                  <p className="lecture-chat-empty-copy">
                    {showsTranscript
                      ? "Use the notes and transcript as context."
                      : "Use the notes as context."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleChatSubmit} className="lecture-chat-composer">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleChatKeyDown}
              disabled={detail.lecture.status !== "ready" || isSending}
              className="lecture-chat-input"
              placeholder="Ask about this lecture"
              rows={1}
            />
            <div className="lecture-chat-composer-footer">
              {chatError ? (
                <p className="lecture-chat-status ios-danger">{chatError}</p>
              ) : detail.lecture.status !== "ready" ? (
                <p className="lecture-chat-status">Available when processing finishes.</p>
              ) : (
                <p className="lecture-chat-status">Answers stay grounded in this lecture.</p>
              )}
              <button
                type="submit"
                disabled={detail.lecture.status !== "ready" || isSending}
                className="lecture-chat-send"
                aria-label="Send message"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </form>
        </div>
      );
    }

    if (activeTab === "transcript") {
      return detail.transcript.length > 0 ? (
        <div className="ios-card lecture-transcript-card">
          {detail.transcript.map((segment) => (
            <div key={segment.id} className="timeline-row">
              <p className="timeline-time">
                {formatTimestamp(segment.start_ms)}
                {segment.end_ms > segment.start_ms
                  ? ` - ${formatTimestamp(segment.end_ms)}`
                  : ""}
                {segment.speaker_label ? ` · ${segment.speaker_label}` : ""}
              </p>
              <p className="m-0 text-[0.98rem] leading-8 text-[var(--label)]">
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="ios-card empty-state lecture-empty-card">
          <p className="ios-row-title">The transcript is still being prepared.</p>
          <p className="ios-row-subtitle">It will appear here when ready.</p>
        </div>
      );
    }

    return (
      <div className="ios-card audio-panel">
        <p className="lecture-card-label">Audio</p>
        {detail.audioUrl ? (
          <audio controls src={detail.audioUrl} className="mt-4 w-full" />
        ) : (
          <div className="empty-state lecture-empty-card">
            <p className="ios-row-title">Audio is not available yet.</p>
            <p className="ios-row-subtitle">It will appear after upload finishes.</p>
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
                {detail.lecture.title ?? "Lecture in progress"}
              </h1>
              <div className="lecture-meta-row">
                <StatusBadge status={detail.lecture.status} />
                <span className="lecture-meta-pill">{sourceLabel(detail.lecture.source_type)}</span>
                <span className="lecture-meta-copy">{formatCalendarDate(detail.lecture.created_at)}</span>
              </div>
            </div>

            <div className="lecture-actions">
              {detail.artifact && activeTab === "notes" ? (
                <button
                  type="button"
                  onClick={downloadPdf}
                  className="lecture-action-button"
                  aria-label="Download PDF"
                  title="Download PDF"
                >
                  {isExportingPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
              ) : null}

              {detail.lecture.status === "failed" && detail.lecture.source_type === "audio" ? (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="lecture-action-button lecture-action-button-danger"
                >
                  {isRetrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  Retry
                </button>
              ) : null}
            </div>
          </div>

          {detail.lecture.error_message ? (
            <p className="danger-panel lecture-inline-note">{detail.lecture.error_message}</p>
          ) : null}

          {shouldPollLecture(detail.lecture.status) ||
          shouldPollAsset(detail.studyAsset?.status) ||
          shouldPollAsset(detail.quizAsset?.status) ? (
            <p className="ios-info lecture-inline-note">
              Processing is still running. This view refreshes automatically.
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
                <tab.icon className="h-4 w-4" />
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
