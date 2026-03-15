"use client";

import type { TDocumentDefinitions } from "pdfmake/interfaces";
import {
  Download,
  FileAudio2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  ScrollText,
  Send,
  Sparkles,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { StatusBadge } from "@/components/status-badge";
import { BRAND_NAME } from "@/lib/brand";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import type { ChatMessageWithCitations, LectureDetail } from "@/lib/types";
import {
  formatLectureDuration,
  formatRelativeDate,
  formatTimestamp,
} from "@/lib/utils";

type WorkspaceTab = "notes" | "chat" | "transcript" | "audio";

function getTabItems(hasAudio: boolean) {
  const items: Array<{
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "notes", label: "Notes", icon: FileText },
    { id: "chat", label: "Chat", icon: MessageSquareText },
    { id: "transcript", label: "Transcript", icon: ScrollText },
  ];

  if (hasAudio) {
    items.push({ id: "audio", label: "Audio", icon: FileAudio2 });
  }

  return items;
}

function shouldPoll(status: LectureDetail["lecture"]["status"]) {
  return ["uploading", "queued", "transcribing", "generating_notes"].includes(status);
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    <div className={`chat-bubble ${assistant ? "assistant" : "user"}`}>
      <div className="ios-message">
        <p className="m-0 text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-[var(--secondary-label)]">
          {assistant ? `${BRAND_NAME} AI` : "You"}
        </p>
        <p className="mt-2 text-[0.96rem] leading-7 text-[var(--label)]">{message.content}</p>
        {message.citations.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.citations.map((citation) => (
              <span
                key={`${message.id}-${citation.idx}-${citation.startMs}`}
                className="ios-status bg-[var(--surface-muted)] text-[var(--secondary-label)]"
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

  useEffect(() => {
    setDetail(initialDetail);
  }, [initialDetail]);

  useEffect(() => {
    if (activeTab === "audio" && !detail.audioUrl) {
      setActiveTab("notes");
    }
  }, [activeTab, detail.audioUrl]);

  useEffect(() => {
    if (!shouldPoll(detail.lecture.status)) {
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
  }, [detail.lecture.id, detail.lecture.status]);

  const exportMarkdown = useMemo(() => {
    const lines = [
      `# ${detail.lecture.title ?? "Lecture"}`,
      "",
      `Status: ${detail.lecture.status}`,
      `Date: ${formatRelativeDate(detail.lecture.created_at)}`,
      "",
      "## Summary",
      "",
      detail.artifact?.summary ?? "Summary is not available yet.",
      "",
      "## Key topics",
      "",
      ...(detail.artifact?.key_topics.map((topic) => `- ${topic}`) ?? [
        "- Key topics are not ready yet.",
      ]),
      "",
      "## Notes",
      "",
      detail.artifact?.structured_notes_md ?? "Notes are not ready yet.",
    ];

    return lines.join("\n");
  }, [detail]);

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

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

  function downloadMarkdown() {
    const blob = new Blob([exportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${detail.lecture.title ?? "note"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPdf() {
    if (!detail.artifact) {
      return;
    }

    setIsExportingPdf(true);

    try {
      const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        import("pdfmake/build/vfs_fonts"),
      ]);
      pdfMake.vfs = pdfFonts?.pdfMake?.vfs ?? pdfFonts?.vfs ?? pdfMake.vfs;

      const docDefinition: TDocumentDefinitions = {
        info: {
          title: detail.lecture.title ?? "Lecture",
        },
        content: [
          {
            text: detail.lecture.title ?? "Lecture",
            style: "title",
          },
          {
            text: `${formatRelativeDate(detail.lecture.created_at)}  •  ${formatLectureDuration(detail.lecture.duration_seconds)}`,
            style: "meta",
          },
          {
            text: "Summary",
            style: "heading",
          },
          {
            text: detail.artifact.summary,
            style: "body",
          },
          {
            text: "Key topics",
            style: "heading",
          },
          {
            ul: detail.artifact.key_topics,
            style: "body",
          },
          {
            text: "Notes",
            style: "heading",
          },
          {
            text: stripMarkdown(detail.artifact.structured_notes_md),
            style: "body",
          },
        ],
        styles: {
          title: { fontSize: 22, bold: true, margin: [0, 0, 0, 8] },
          meta: { fontSize: 10, color: "#6f7280", margin: [0, 0, 0, 18] },
          heading: { fontSize: 13, bold: true, margin: [0, 12, 0, 6] },
          body: { fontSize: 11, lineHeight: 1.45, color: "#111111" },
        },
        defaultStyle: {
          fontSize: 11,
        },
        pageMargins: [40, 48, 40, 48],
      };

      pdfMake.createPdf(docDefinition).download(`${detail.lecture.title ?? "note"}.pdf`);
    } finally {
      setIsExportingPdf(false);
    }
  }

  function renderPanel() {
    if (activeTab === "notes") {
      return (
        <div className="workspace-panel-stack">
          <div className="ios-card">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--tint)]" />
              <p className="ios-section-label">Summary</p>
            </div>
            <p className="mt-4 text-[1rem] leading-8 text-[var(--label)]">
              {detail.artifact?.summary ?? "The summary will appear once processing is complete."}
            </p>
          </div>

          <div className="ios-card">
            <p className="ios-section-label">Structured notes</p>
            <div className="markdown mt-4">
              {detail.artifact ? (
                <MarkdownRenderer content={detail.artifact.structured_notes_md} />
              ) : (
                <p className="ios-info">Notes are not ready yet.</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "chat") {
      return (
        <div className="workspace-panel-stack">
          <div className="ios-card">
            <p className="ios-section-label">Chat with this note</p>
            <div className="chat-thread mt-4">
              {detail.chatMessages.length > 0 ? (
                detail.chatMessages.map((message) => (
                  <ChatBubble key={message.id} message={message} />
                ))
              ) : (
                <div className="empty-state">
                  <p className="ios-row-title">No questions yet.</p>
                  <p className="ios-row-subtitle">
                    Once the notes are ready, you can ask follow-up questions here.
                  </p>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleChatSubmit} className="ios-card">
            <p className="ios-section-label">New question</p>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={detail.lecture.status !== "ready" || isSending}
              className="ios-textarea mt-4"
              placeholder="Ask something about this note"
            />
            {chatError ? <p className="ios-info ios-danger mt-3">{chatError}</p> : null}
            <button
              type="submit"
              disabled={detail.lecture.status !== "ready" || isSending}
              className="ios-primary-button mt-4 sm:w-auto"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </form>
        </div>
      );
    }

    if (activeTab === "transcript") {
      return detail.transcript.length > 0 ? (
        <div className="ios-group">
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
        <div className="empty-state">
          <p className="ios-row-title">The transcript is still being prepared.</p>
          <p className="ios-row-subtitle">When processing is done, the transcript will appear here.</p>
        </div>
      );
    }

    return (
      <div className="ios-card audio-panel">
        <p className="ios-section-label">Source audio</p>
        {detail.audioUrl ? (
          <audio controls src={detail.audioUrl} className="w-full" />
        ) : (
          <div className="empty-state">
            <p className="ios-row-title">Audio is not available yet.</p>
            <p className="ios-row-subtitle">It will appear after the upload finishes.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-grid">
      <div className="workspace-panel-stack">
        <div className="space-y-4 mb-4">
          <div className="ios-title-block mb-2">
            <p className="ios-section-label tracking-wider uppercase text-xs font-bold text-[var(--secondary-label)] mb-1">Workspace</p>
            <h1 className="ios-large-title">
              {detail.lecture.title ?? "Lecture in progress"}
            </h1>
            <p className="ios-subtitle mt-2">
              {formatRelativeDate(detail.lecture.created_at)} &middot;{" "}
              {formatLectureDuration(detail.lecture.duration_seconds)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.lecture.status} />
            <span className="ios-status bg-[var(--surface-muted)] text-[var(--secondary-label)]">
              {sourceLabel(detail.lecture.source_type)}
            </span>
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            {detail.artifact ? (
              <>
                <button type="button" onClick={downloadMarkdown} className="ios-text-button">
                  <Download className="h-4 w-4" />
                  Markdown
                </button>
                <button type="button" onClick={downloadPdf} className="ios-text-button">
                  {isExportingPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  PDF
                </button>
              </>
            ) : null}

            {detail.lecture.status === "failed" && detail.lecture.source_type === "audio" ? (
              <button type="button" onClick={handleRetry} className="ios-text-button text-[var(--red)]">
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                Retry
              </button>
            ) : null}
          </div>

          {detail.lecture.error_message ? (
            <p className="danger-panel mt-2">{detail.lecture.error_message}</p>
          ) : null}

          {shouldPoll(detail.lecture.status) ? (
            <p className="ios-info mt-2">Processing is still running. This view refreshes automatically.</p>
          ) : null}
        </div>

        <div className="ios-segmented">
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

      <aside className="workspace-side-column">
        <div className="workspace-summary-grid">
          <div className="metric-card">
            <p className="ios-section-label">Topics</p>
            <p className="app-stat-value !text-[2rem]">
              {detail.artifact?.key_topics.length ?? 0}
            </p>
            <p className="app-stat-label">Key topics extracted</p>
          </div>

          <div className="metric-card">
            <p className="ios-section-label">Transcript</p>
            <p className="app-stat-value !text-[2rem]">{detail.transcript.length}</p>
            <p className="app-stat-label">Timeline segments</p>
          </div>
        </div>

        <div className="workspace-side-card">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--tint)]" />
            <p className="ios-section-label">Key topics</p>
          </div>

          {detail.artifact?.key_topics.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {detail.artifact.key_topics.map((topic) => (
                <span
                  key={topic}
                  className="ios-status bg-[var(--surface-muted)] text-[var(--secondary-label)]"
                >
                  {topic}
                </span>
              ))}
            </div>
          ) : (
            <p className="ios-row-subtitle mt-3">Topics will appear after processing is complete.</p>
          )}
        </div>

        <div className="workspace-side-card">
          <div className="flex items-center gap-2">
            <Waves className="h-4 w-4 text-[var(--tint)]" />
            <p className="ios-section-label">Details</p>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <p className="ios-row-title">Source</p>
              <p className="ios-row-subtitle">{sourceLabel(detail.lecture.source_type)}</p>
            </div>
            <div>
              <p className="ios-row-title">Created</p>
              <p className="ios-row-subtitle">{formatRelativeDate(detail.lecture.created_at)}</p>
            </div>
            <div>
              <p className="ios-row-title">Duration</p>
              <p className="ios-row-subtitle">
                {formatLectureDuration(detail.lecture.duration_seconds)}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
