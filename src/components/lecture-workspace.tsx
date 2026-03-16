"use client";

import {
  Brain,
  ChevronLeft,
  ChevronRight,
  Download,
  FileAudio2,
  FileText,
  FlipHorizontal2,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  ScrollText,
  Send,
  Shuffle,
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

function studyStatusCopy(status: StudyAssetStatus | null | undefined) {
  if (status === "generating") {
    return "Flashcards are generating from the lecture context.";
  }

  if (status === "queued") {
    return "Flashcards are queued and will appear soon.";
  }

  if (status === "failed") {
    return "Flashcard generation failed. Regenerate to try again.";
  }

  return "Review the lecture with AI-generated flashcards grounded in the transcript.";
}

function confidenceLabel(value: FlashcardConfidenceBucket) {
  if (value === "again") {
    return "Again";
  }

  if (value === "good") {
    return "Good";
  }

  return "Easy";
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
  const [activeFlashcardIndex, setActiveFlashcardIndex] = useState(0);
  const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
  const [activeProgressFlashcardId, setActiveProgressFlashcardId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

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
    if (activeFlashcardIndex >= detail.flashcards.length) {
      setActiveFlashcardIndex(0);
    }
  }, [activeFlashcardIndex, detail.flashcards.length]);

  useEffect(() => {
    setIsFlashcardFlipped(false);
  }, [activeFlashcardIndex, activeTab]);

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
    const flashcard = detail.flashcards[activeFlashcardIndex];
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
  }

  function showNextFlashcard() {
    setActiveFlashcardIndex((current) =>
      detail.flashcards.length === 0 ? 0 : (current + 1) % detail.flashcards.length,
    );
  }

  function showPreviousFlashcard() {
    setActiveFlashcardIndex((current) =>
      detail.flashcards.length === 0
        ? 0
        : (current - 1 + detail.flashcards.length) % detail.flashcards.length,
    );
  }

  function shuffleFlashcards() {
    if (detail.flashcards.length <= 1) {
      return;
    }

    let nextIndex = activeFlashcardIndex;

    while (nextIndex === activeFlashcardIndex) {
      nextIndex = Math.floor(Math.random() * detail.flashcards.length);
    }

    setActiveFlashcardIndex(nextIndex);
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
      const currentFlashcard = detail.flashcards[activeFlashcardIndex] ?? null;

      return (
        <div className="workspace-panel-stack lecture-panel-stack">
          <div className="ios-card lecture-study-shell">
            <div className="lecture-study-header">
              <div>
                <p className="lecture-card-label">Study</p>
                <p className="lecture-study-copy">{studyStatusCopy(detail.studyAsset?.status)}</p>
              </div>

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
              <span className="lecture-study-meta-copy">
                {detail.flashcards.length} {detail.flashcards.length === 1 ? "flashcard" : "flashcards"}
              </span>
            </div>

            {studyError ? <p className="danger-panel lecture-inline-note">{studyError}</p> : null}
            {detail.studyAsset?.error_message ? (
              <p className="danger-panel lecture-inline-note">{detail.studyAsset.error_message}</p>
            ) : null}

            {detail.flashcards.length > 0 && currentFlashcard ? (
              <>
                <div
                  className={`lecture-flashcard ${isFlashcardFlipped ? "flipped" : ""}`}
                  onClick={() => setIsFlashcardFlipped((current) => !current)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setIsFlashcardFlipped((current) => !current);
                    }
                  }}
                >
                  <div className="lecture-flashcard-face lecture-flashcard-face-front">
                    <div className="lecture-flashcard-face-meta">
                      <span>
                        Card {activeFlashcardIndex + 1} / {detail.flashcards.length}
                      </span>
                      <span className={`lecture-flashcard-difficulty ${currentFlashcard.difficulty}`}>
                        {currentFlashcard.difficulty}
                      </span>
                    </div>
                    <p className="lecture-flashcard-title">Prompt</p>
                    <p className="lecture-flashcard-content">{currentFlashcard.front}</p>
                    <p className="lecture-flashcard-hintline">
                      {currentFlashcard.hint ?? "Tap to reveal the answer."}
                    </p>
                  </div>

                  <div className="lecture-flashcard-face lecture-flashcard-face-back">
                    <div className="lecture-flashcard-face-meta">
                      <span>Answer</span>
                      {currentFlashcard.progress ? (
                        <span className="lecture-flashcard-progress-pill">
                          {confidenceLabel(currentFlashcard.progress.confidence_bucket)}
                        </span>
                      ) : null}
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
                  </div>
                </div>

                <div className="lecture-flashcard-toolbar">
                  <div className="lecture-flashcard-nav">
                    <button
                      type="button"
                      onClick={showPreviousFlashcard}
                      className="lecture-study-action"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFlashcardFlipped((current) => !current)}
                      className="lecture-study-action"
                    >
                      <FlipHorizontal2 className="h-4 w-4" />
                      Flip
                    </button>
                    <button
                      type="button"
                      onClick={shuffleFlashcards}
                      className="lecture-study-action"
                    >
                      <Shuffle className="h-4 w-4" />
                      Shuffle
                    </button>
                    <button
                      type="button"
                      onClick={showNextFlashcard}
                      className="lecture-study-action"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="lecture-flashcard-review">
                    {(["again", "good", "easy"] as const).map((bucket) => (
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
                </div>
              </>
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
