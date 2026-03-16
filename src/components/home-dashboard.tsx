"use client";

import Link from "next/link";
import {
  AlertCircle,
  ChevronRight,
  FileAudio2,
  FileUp,
  Link2,
  Loader2,
  Mic,
  MoreVertical,
  Search,
  Type,
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { NoteSourceModal, type NoteSourceMode } from "@/components/note-source-modal";
import { StatusBadge } from "@/components/status-badge";
import { LibraryFolderMenu } from "@/components/library-folder-menu";
import type { AppLectureListItem } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    id: "record" as const,
    label: "Record lecture",
    detail: "Start in one tap",
    icon: Mic,
    accent: "record",
  },
  {
    id: "upload" as const,
    label: "Upload audio",
    detail: "MP3, M4A, WAV, or WEBM",
    icon: Mic,
    accent: "default",
  },
  {
    id: "link" as const,
    label: "Add link",
    detail: "Web article or source",
    icon: Link2,
    accent: "default",
  },
  {
    id: "text" as const,
    label: "Paste text or PDF",
    detail: "Turn source material into structured notes",
    icon: FileUp,
    accent: "default",
  },
] as const;

function sourceLabel(sourceType: string) {
  if (sourceType === "link") {
    return "Link";
  }

  if (sourceType === "text") {
    return "Text";
  }

  if (sourceType === "pdf") {
    return "PDF";
  }

  return "Audio";
}

function SourceIcon({ sourceType }: { sourceType: string }) {
  if (sourceType === "link") {
    return <Link2 className="h-4 w-4" />;
  }

  if (sourceType === "text" || sourceType === "pdf") {
    return <Type className="h-4 w-4" />;
  }

  return <Mic className="h-4 w-4" />;
}

export function HomeDashboard({
  lectures,
}: {
  lectures: AppLectureListItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [manualModal, setManualModal] = useState<NoteSourceMode | null>(null);
  const [libraryLectures, setLibraryLectures] = useState(lectures);
  const [busyLectureId, setBusyLectureId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderLectureIds, setSelectedFolderLectureIds] = useState<string[] | null>(null);
  const [openMenuLectureId, setOpenMenuLectureId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const searchModal = (() => {
    const mode = searchParams.get("mode");
    return mode === "record" || mode === "link" || mode === "text" || mode === "upload"
      ? mode
      : null;
  })();

  const activeModal = manualModal ?? searchModal;

  useEffect(() => {
    setLibraryLectures(lectures);
  }, [lectures]);

  useEffect(() => {
    if (!openMenuLectureId) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenuLectureId(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [openMenuLectureId]);

  function closeModal() {
    setManualModal(null);
    if (searchModal) {
      router.replace("/app", { scroll: false });
    }
  }

  async function handleDeleteLecture(id: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) {
      return;
    }

    setOpenMenuLectureId(null);
    setBusyLectureId(id);
    const response = await fetch(`/api/lectures/${id}`, { method: "DELETE" });
    setBusyLectureId(null);

    if (!response.ok) {
      return;
    }

    setLibraryLectures((current) => current.filter((lecture) => lecture.id !== id));
    startTransition(() => router.refresh());
  }

  async function handleRetryLecture(id: string) {
    setBusyLectureId(id);
    const response = await fetch(`/api/lectures/${id}/retry`, { method: "POST" });
    setBusyLectureId(null);

    if (!response.ok) {
      return;
    }

    startTransition(() => router.refresh());
  }

  async function handleRenameLecture(lecture: AppLectureListItem) {
    const currentTitle = lecture.title?.trim() || "Untitled note";
    const nextTitle = window.prompt("Rename note", currentTitle)?.trim();

    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }

    setOpenMenuLectureId(null);
    setBusyLectureId(lecture.id);
    const response = await fetch(`/api/lectures/${lecture.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: nextTitle }),
    });
    setBusyLectureId(null);

    if (!response.ok) {
      return;
    }

    setLibraryLectures((current) =>
      current.map((item) =>
        item.id === lecture.id
          ? {
              ...item,
              title: nextTitle,
            }
          : item,
      ),
    );
    startTransition(() => router.refresh());
  }

  const visibleLectures = selectedFolderLectureIds
    ? libraryLectures.filter((lecture) => selectedFolderLectureIds.includes(lecture.id))
    : libraryLectures;
  const search = deferredQuery.trim().toLowerCase();
  const filteredLectures = visibleLectures.filter((lecture) => {
    if (!search) {
      return true;
    }

    return (
      lecture.title?.toLowerCase().includes(search) ||
      lecture.error_message?.toLowerCase().includes(search) ||
      sourceLabel(lecture.source_type).toLowerCase().includes(search)
    );
  });

  const failedLectures = filteredLectures.filter((lecture) => lecture.status === "failed");
  const regularLectures = filteredLectures.filter((lecture) => lecture.status !== "failed");
  return (
    <>
      <div className="home-dashboard pb-8">
        <section className="dashboard-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">New note</h2>
          </div>
          <p className="dashboard-section-lead">
            Record audio, upload audio, add a link, or paste text.
          </p>

          <div className="note-action-grid">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => setManualModal(action.id)}
                className="note-action-card"
              >
                <span
                  className={`note-action-card-icon ${
                    action.accent === "record" ? "record" : ""
                  }`}
                >
                  <action.icon className="h-5 w-5" />
                </span>
                <span className="note-action-card-copy">
                  <span className="note-action-card-label">{action.label}</span>
                  <span className="note-action-card-detail">{action.detail}</span>
                </span>
                <ChevronRight className="note-action-card-chevron h-4 w-4" />
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-section mt-4">
          <div className="dashboard-section-heading mb-4">
            <h2 className="dashboard-section-title">My notes</h2>
            <p className="dashboard-section-meta">
              {filteredLectures.length} {filteredLectures.length === 1 ? "note" : "notes"}
            </p>
          </div>

          <div className="dashboard-toolbar library-toolbar">
            <LibraryFolderMenu
              lectures={libraryLectures}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(folderId, lectureIds) => {
                setSelectedFolderId(folderId);
                setSelectedFolderLectureIds(lectureIds);
              }}
            />

            <div className="ios-search notes-search">
              <Search className="h-4 w-4 text-[var(--secondary-label)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title, source, or error"
              />
            </div>
          </div>

          {failedLectures.length > 0 ? (
            <div className="dashboard-subsection">
              <div className="dashboard-subsection-heading">
                <h3 className="dashboard-subsection-title">Needs attention</h3>
              </div>

              {failedLectures.map((lecture) => (
                <div key={lecture.id} className="dashboard-alert-card">
                  <div className="ios-row-icon" style={{ backgroundColor: "var(--red-soft)", color: "var(--red)", width: "2rem", height: "2rem" }}>
                    <AlertCircle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="ios-row-title text-[var(--red)] font-medium">
                      {lecture.error_message ? "Error processing note" : "Error creating note"}
                    </p>
                    <p className="ios-row-subtitle mt-1" style={{ fontSize: "0.8rem", color: "var(--label)" }}>
                      Retry the note or remove it from the library.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyLectureId === lecture.id}
                      onClick={() => void handleDeleteLecture(lecture.id)}
                      className="ios-text-button"
                      style={{ color: "var(--red)", backgroundColor: "var(--red-soft)", padding: "0.3rem 1rem", borderRadius: "10px", fontSize: "0.85rem", fontWeight: 600 }}
                    >
                      {busyLectureId === lecture.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Delete
                    </button>
                    {lecture.source_type === "audio" ? (
                      <button
                        type="button"
                        disabled={busyLectureId === lecture.id}
                        onClick={() => void handleRetryLecture(lecture.id)}
                        className="ios-text-button"
                        style={{ color: "var(--label)", backgroundColor: "var(--surface-muted)", padding: "0.3rem 1rem", borderRadius: "10px", fontSize: "0.85rem", fontWeight: 600 }}
                      >
                        {busyLectureId === lecture.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Retry
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {regularLectures.length > 0 ? (
            <div className="dashboard-note-list">
              {regularLectures.map((lecture) => (
                <div
                  key={lecture.id}
                  className={`ios-row-note-card ${openMenuLectureId === lecture.id ? "menu-open" : ""}`}
                >
                  <Link
                    href={`/app/lectures/${lecture.id}`}
                    className="ios-row-note-card-link"
                  >
                    <div className="ios-row-icon" style={{ backgroundColor: "var(--surface-muted)" }}>
                      <SourceIcon sourceType={lecture.source_type} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="ios-row-title truncate font-medium">
                        {lecture.title ?? "Untitled note"}
                      </p>
                      <p className="ios-row-subtitle mt-1">
                        {sourceLabel(lecture.source_type)} • {formatRelativeDate(lecture.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {lecture.status !== "ready" && <StatusBadge status={lecture.status} />}
                    </div>
                  </Link>

                  <div
                    ref={openMenuLectureId === lecture.id ? menuRef : null}
                    className="dashboard-note-actions"
                  >
                    <button
                      type="button"
                      aria-label={`Open actions for ${lecture.title ?? "note"}`}
                      disabled={busyLectureId === lecture.id}
                      onClick={() =>
                        setOpenMenuLectureId((current) =>
                          current === lecture.id ? null : lecture.id,
                        )
                      }
                      className="dashboard-note-menu-button"
                    >
                      {busyLectureId === lecture.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MoreVertical className="h-4 w-4" />
                      )}
                    </button>

                    {openMenuLectureId === lecture.id ? (
                      <div className="dashboard-note-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuLectureId(null);
                            router.push(`/app/lectures/${lecture.id}`);
                          }}
                          className="dashboard-note-menu-item"
                        >
                          Open note
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRenameLecture(lecture)}
                          className="dashboard-note-menu-item"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteLecture(lecture.id)}
                          className="dashboard-note-menu-item danger"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state app-empty-state">
              <div className="app-empty-state-icon">
                <FileAudio2 className="h-5 w-5" />
              </div>
              <p className="ios-row-title">
                {search
                  ? "No matching notes"
                  : selectedFolderId
                    ? "This folder is empty"
                    : "Your library is empty"}
              </p>
              <p className="ios-row-subtitle mt-2">
                {search
                  ? "Try a shorter search term or clear the query."
                  : selectedFolderId
                    ? "Add lectures to this folder or switch back to all notes."
                    : "Start with a recording, audio upload, PDF, text, or link."}
              </p>
              {!search && !selectedFolderId ? (
                <button
                  type="button"
                  onClick={() => setManualModal("record")}
                  className="app-home-highlight-link"
                >
                  <span>Create your first note</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <NoteSourceModal mode={activeModal} open={Boolean(activeModal)} onClose={closeModal} />
    </>
  );
}
