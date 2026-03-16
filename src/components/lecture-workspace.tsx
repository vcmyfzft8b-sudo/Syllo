"use client";

import {
  Brain,
  Download,
  FileAudio2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  ScrollText,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { StatusBadge } from "@/components/status-badge";
import type { FlashcardConfidenceBucket, StudyAssetStatus } from "@/lib/database.types";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import type { ChatMessageWithCitations, LectureDetail } from "@/lib/types";
import {
  formatLectureDuration,
  formatRelativeDate,
  formatTimestamp,
} from "@/lib/utils";

type WorkspaceTab = "notes" | "study" | "chat" | "transcript" | "audio";

function getTabItems(hasAudio: boolean) {
  const items: Array<{
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "notes", label: "Notes", icon: FileText },
    { id: "study", label: "Study", icon: Brain },
    { id: "chat", label: "Chat", icon: MessageSquareText },
    { id: "transcript", label: "Transcript", icon: ScrollText },
  ];

  if (hasAudio) {
    items.push({ id: "audio", label: "Audio", icon: FileAudio2 });
  }

  return items;
}

function shouldPollLecture(status: LectureDetail["lecture"]["status"]) {
  return ["uploading", "queued", "transcribing", "generating_notes"].includes(status);
}

function shouldPollStudy(status: StudyAssetStatus | null | undefined) {
  return status === "queued" || status === "generating";
}

function confidenceLabel(value: FlashcardConfidenceBucket) {
  if (value === "again") {
    return "Didn't know";
  }
  return "Knew it";
}

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
  const [studyError, setStudyError] = useState<string | null>(null);
  const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<string[]>(() =>
    initialDetail.flashcards.map((flashcard) => flashcard.id),
  );
  const [repeatQueue, setRepeatQueue] = useState<string[]>([]);
  const [reviewCycle, setReviewCycle] = useState(1);
  const [cycleCardCount, setCycleCardCount] = useState(initialDetail.flashcards.length);
  const [activeProgressFlashcardId, setActiveProgressFlashcardId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const flashcardDeckKey = detail.flashcards.map((flashcard) => flashcard.id).join("|");
  const currentReviewFlashcardId = reviewQueue[0] ?? null;

  useEffect(() => {
    setDetail(initialDetail);
  }, [initialDetail]);

  useEffect(() => {
    if (activeTab === "audio" && !detail.audioUrl) {
      setActiveTab("notes");
    }
  }, [activeTab, detail.audioUrl]);

  useEffect(() => {
    if (activeTab === "study" && detail.flashcards.length === 0 && detail.audioUrl && detail.lecture.status !== "ready") {
      setActiveTab("notes");
    }
  }, [activeTab, detail.audioUrl, detail.flashcards.length, detail.lecture.status]);

  useEffect(() => {
    if (
      !shouldPollLecture(detail.lecture.status) &&
      !shouldPollStudy(detail.studyAsset?.status)
    ) {
      return;
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/lectures/${detail.lecture.id}`);
      if (!response.ok) {
        return;
      }

      const nextDetail = (await response.json()) as LectureDetail;
      setDetail(nextDetail);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [detail.lecture.id, detail.lecture.status, detail.studyAsset?.status]);

  useEffect(() => {
    setIsFlashcardFlipped(false);
  }, [activeTab, currentReviewFlashcardId]);

  useEffect(() => {
    const initialQueue = flashcardDeckKey ? flashcardDeckKey.split("|") : [];
    setReviewQueue(initialQueue);
    setRepeatQueue([]);
    setReviewCycle(1);
    setCycleCardCount(initialQueue.length);
    setStudyError(null);
  }, [flashcardDeckKey]);

  useEffect(() => {
    if (reviewQueue.length > 0 || repeatQueue.length === 0) {
      return;
    }

    setCycleCardCount(repeatQueue.length);
    setReviewQueue(repeatQueue);
    setRepeatQueue([]);
    setReviewCycle((current) => current + 1);
  }, [repeatQueue, reviewQueue]);

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

  const cleanedStructuredNotes = useMemo(() => {
    if (!detail.artifact?.structured_notes_md) {
      return null;
    }

    return stripLeadingRedundantHeading(
      detail.artifact.structured_notes_md,
      detail.lecture.title,
    );
  }, [detail.artifact?.structured_notes_md, detail.lecture.title]);

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

  async function handleStudyRegenerate() {
    setStudyError(null);
    setIsRegeneratingStudy(true);
    const response = await fetch(`/api/lectures/${detail.lecture.id}/study/regenerate`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    setIsRegeneratingStudy(false);

    if (!response.ok) {
      setStudyError(payload?.error ?? "Study tools could not be regenerated.");
      return;
    }

    const refresh = await fetch(`/api/lectures/${detail.lecture.id}`);
    if (refresh.ok) {
      setDetail((await refresh.json()) as LectureDetail);
    }
  }

  async function handleFlashcardProgress(confidenceBucket: FlashcardConfidenceBucket) {
    const currentFlashcardId = reviewQueue[0];
    const flashcard = detail.flashcards.find((item) => item.id === currentFlashcardId);
    if (!flashcard) {
      return;
    }

    setStudyError(null);
    setActiveProgressFlashcardId(flashcard.id);
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
      setStudyError(payload?.error ?? "Flashcard progress could not be saved.");
      return;
    }

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

    setReviewQueue((current) => {
      const [activeId, ...remaining] = current;
      return activeId === flashcard.id ? remaining : current;
    });

    if (confidenceBucket === "again") {
      setRepeatQueue((current) => [...current, flashcard.id]);
    }
  }

  function restartFlashcardReview() {
    const initialQueue = detail.flashcards.map((flashcard) => flashcard.id);
    setReviewQueue(initialQueue);
    setRepeatQueue([]);
    setReviewCycle(1);
    setCycleCardCount(initialQueue.length);
    setIsFlashcardFlipped(false);
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
          <div className="ios-card lecture-summary-card">
            <div className="lecture-card-heading">
              <p className="lecture-card-label">Summary</p>
            </div>
            <p className="lecture-summary-text">
              {detail.artifact?.summary ?? "The summary will appear once processing is complete."}
            </p>
          </div>

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
      const currentFlashcard =
        detail.flashcards.find((flashcard) => flashcard.id === currentReviewFlashcardId) ?? null;
      const masteredCount = detail.flashcards.length - reviewQueue.length - repeatQueue.length;
      const completedCount = Math.max(masteredCount, 0);
      const currentCyclePosition = cycleCardCount > 0 ? cycleCardCount - reviewQueue.length + 1 : 0;

      return (
        <div className="workspace-panel-stack lecture-panel-stack">
          <div className="ios-card lecture-study-shell">
            <div className="lecture-study-header">
              <p className="lecture-card-label">Study</p>

              <button
                type="button"
                onClick={handleStudyRegenerate}
                disabled={detail.lecture.status !== "ready" || isRegeneratingStudy}
                className="lecture-study-refresh"
              >
                {isRegeneratingStudy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                Regenerate
              </button>
            </div>

            <div className="lecture-study-meta">
              <span className={`lecture-study-status ${detail.studyAsset?.status ?? "ready"}`}>
                {detail.studyAsset?.status ?? "ready"}
              </span>
            </div>

            {studyError ? <p className="danger-panel lecture-inline-note">{studyError}</p> : null}
            {detail.studyAsset?.error_message ? (
              <p className="danger-panel lecture-inline-note">{detail.studyAsset.error_message}</p>
            ) : null}

            {detail.flashcards.length > 0 && currentFlashcard ? (
              <>
                <div className="lecture-flashcard-stage">
                  <div className="lecture-flashcard-stage-meta">
                    <span>Cycle {reviewCycle}</span>
                    <span>
                      Card {currentCyclePosition} / {cycleCardCount}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={`lecture-flashcard ${isFlashcardFlipped ? "flipped" : ""}`}
                    onClick={() => setIsFlashcardFlipped((current) => !current)}
                  >
                    <div className="lecture-flashcard-rotator">
                      <div className="lecture-flashcard-face lecture-flashcard-face-front">
                        <div className="lecture-flashcard-face-meta">
                          <span>Question</span>
                          <span className={`lecture-flashcard-difficulty ${currentFlashcard.difficulty}`}>
                            {currentFlashcard.difficulty}
                          </span>
                        </div>
                        <p className="lecture-flashcard-content">{currentFlashcard.front}</p>
                        <p className="lecture-flashcard-hintline">
                          Click anywhere on the card to reveal the answer.
                        </p>
                      </div>
                      <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                        <div className="lecture-flashcard-face-meta">
                          <span>Answer</span>
                        </div>
                        <p className="lecture-flashcard-content">{currentFlashcard.back}</p>
                        <div className="lecture-flashcard-citations">
                          {currentFlashcard.citations.map((citation) => (
                            <span
                              key={`${currentFlashcard.id}-${citation.idx}-${citation.startMs}`}
                              className="lecture-flashcard-citation"
                            >
                              {formatTimestamp(citation.startMs)}
                            </span>
                          ))}
                        </div>
                        <p className="lecture-flashcard-hintline">
                          {currentFlashcard.hint ?? "Choose whether you knew it before moving on."}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="lecture-flashcard-toolbar">
                  {isFlashcardFlipped ? (
                    <div className="lecture-flashcard-review">
                      {(["again", "easy"] as const).map((bucket) => (
                        <button
                          key={bucket}
                          type="button"
                          onClick={() => void handleFlashcardProgress(bucket)}
                          disabled={activeProgressFlashcardId === currentFlashcard.id}
                          className={`lecture-flashcard-review-button ${bucket}`}
                        >
                          {activeProgressFlashcardId === currentFlashcard.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {confidenceLabel(bucket)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            ) : detail.flashcards.length > 0 ? (
              <div className="empty-state lecture-empty-card lecture-study-empty">
                <p className="ios-row-title">Flashcard set complete.</p>
                <p className="ios-row-subtitle">
                  You completed this flashcard set and marked {completedCount} cards as known.
                </p>
                <button
                  type="button"
                  onClick={restartFlashcardReview}
                  className="lecture-study-refresh lecture-study-restart"
                >
                  Start over
                </button>
              </div>
            ) : (
              <div className="empty-state lecture-empty-card lecture-study-empty">
                <p className="ios-row-title">
                  {detail.lecture.status === "ready"
                    ? "Flashcards are not ready yet."
                    : "Study tools unlock after processing finishes."}
                </p>
                <p className="ios-row-subtitle">
                  {detail.lecture.status === "ready"
                    ? "Regenerate flashcards to create a fresh deck from this lecture."
                    : "Once the lecture is ready, the study tab will fill with flashcards automatically."}
                </p>
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
                  <p className="lecture-chat-empty-title">Ask about this lecture.</p>
                  <p className="lecture-chat-empty-copy">
                    Use the notes and transcript as context.
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
                <span className="lecture-meta-copy">{formatRelativeDate(detail.lecture.created_at)}</span>
                <span className="lecture-meta-dot" aria-hidden="true">
                  •
                </span>
                <span className="lecture-meta-copy">
                  {formatLectureDuration(detail.lecture.duration_seconds)}
                </span>
              </div>
            </div>

            <div className="lecture-actions">
              {detail.artifact ? (
                <button type="button" onClick={downloadPdf} className="lecture-action-button">
                  {isExportingPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  PDF
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

          {shouldPollLecture(detail.lecture.status) || shouldPollStudy(detail.studyAsset?.status) ? (
            <p className="ios-info lecture-inline-note">
              Processing is still running. This view refreshes automatically.
            </p>
          ) : null}
        </div>

        <div className="ios-segmented lecture-segmented">
          {getTabItems(Boolean(detail.audioUrl)).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`ios-segment ${activeTab === tab.id ? "active" : ""}`}
            >
              <span className="inline-flex items-center gap-2">
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        {renderPanel()}
      </div>
    </div>
  );
}
