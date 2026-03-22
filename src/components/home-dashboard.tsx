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
  Pencil,
  Search,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { NoteSourceModal, type NoteSourceMode } from "@/components/note-source-modal";
import { StatusBadge } from "@/components/status-badge";
import { LibraryFolderMenu } from "@/components/library-folder-menu";
import type { AppLectureListItem } from "@/lib/types";
import { formatCalendarDate } from "@/lib/utils";

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
    id: "text" as const,
    label: "Paste text or PDF",
    detail: "Turn source material into structured notes",
    icon: FileUp,
    accent: "default",
  },
  {
    id: "link" as const,
    label: "Add link",
    detail: "Web article or source",
    icon: Link2,
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

type NoteRowProps = {
  lecture: AppLectureListItem;
  isMenuOpen: boolean;
  isBusy: boolean;
  onToggleMenu: (lectureId: string) => void;
  onOpenRename: (lecture: AppLectureListItem) => void;
  onOpenDelete: (lecture: AppLectureListItem) => void;
  attachMenuRef: (node: HTMLDivElement | null) => void;
};

const NoteRow = memo(function NoteRow({
  lecture,
  isMenuOpen,
  isBusy,
  onToggleMenu,
  onOpenRename,
  onOpenDelete,
  attachMenuRef,
}: NoteRowProps) {
  return (
    <div className={`ios-row-note-card ${isMenuOpen ? "menu-open" : ""}`}>
      <Link href={`/app/lectures/${lecture.id}`} className="ios-row-note-card-link">
        <div className="ios-row-icon" style={{ backgroundColor: "var(--surface-muted)" }}>
          <SourceIcon sourceType={lecture.source_type} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="ios-row-title truncate font-medium">{lecture.title ?? "Untitled note"}</p>
          <p className="ios-row-subtitle mt-1">
            {sourceLabel(lecture.source_type)} • {formatCalendarDate(lecture.created_at)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lecture.status !== "ready" && <StatusBadge status={lecture.status} />}
        </div>
      </Link>

      <div ref={isMenuOpen ? attachMenuRef : undefined} className="dashboard-note-actions">
        <button
          type="button"
          aria-label={`Open actions for ${lecture.title ?? "note"}`}
          disabled={isBusy}
          onClick={() => onToggleMenu(lecture.id)}
          className="dashboard-note-menu-button"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreVertical className="h-4 w-4" />
          )}
        </button>

        {isMenuOpen ? (
          <div className="dashboard-note-menu">
            <button
              type="button"
              onClick={() => onOpenRename(lecture)}
              className="dashboard-note-menu-item"
              aria-label="Rename note"
              title="Rename note"
            >
              <Pencil className="h-4 w-4" />
              <span>Rename</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenDelete(lecture)}
              className="dashboard-note-menu-item danger"
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}, (previousProps, nextProps) => {
  return (
    previousProps.lecture === nextProps.lecture &&
    previousProps.isMenuOpen === nextProps.isMenuOpen &&
    previousProps.isBusy === nextProps.isBusy
  );
});

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
  const [renameTarget, setRenameTarget] = useState<AppLectureListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AppLectureListItem | null>(null);
  const deferredQuery = useDeferredValue(query);
  const selectedFolderLectureIdSet = useMemo(
    () => (selectedFolderLectureIds ? new Set(selectedFolderLectureIds) : null),
    [selectedFolderLectureIds],
  );

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

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenuLectureId(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [openMenuLectureId]);

  useEffect(() => {
    for (const item of libraryLectures.slice(0, 24)) {
      router.prefetch(`/app/lectures/${item.id}`);
    }
  }, [libraryLectures, router]);

  useEffect(() => {
    if (!renameTarget && !deleteTarget) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (busyLectureId) {
        return;
      }

      setRenameTarget(null);
      setRenameValue("");
      setDeleteTarget(null);
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busyLectureId, deleteTarget, renameTarget]);

  function closeModal() {
    setManualModal(null);
    if (searchModal) {
      router.replace("/app", { scroll: false });
    }
  }

  function openRenameModal(lecture: AppLectureListItem) {
    setOpenMenuLectureId(null);
    setRenameTarget(lecture);
    setRenameValue(lecture.title?.trim() || "Untitled note");
  }

  function closeRenameModal() {
    if (busyLectureId === renameTarget?.id) {
      return;
    }

    setRenameTarget(null);
    setRenameValue("");
  }

  function openDeleteModal(lecture: AppLectureListItem) {
    setOpenMenuLectureId(null);
    setDeleteTarget(lecture);
  }

  function closeDeleteModal() {
    if (busyLectureId === deleteTarget?.id) {
      return;
    }

    setDeleteTarget(null);
  }

  async function handleDeleteLecture() {
    if (!deleteTarget) {
      return;
    }

    setBusyLectureId(deleteTarget.id);
    const response = await fetch(`/api/lectures/${deleteTarget.id}`, { method: "DELETE" });
    setBusyLectureId(null);

    if (!response.ok) {
      return;
    }

    setLibraryLectures((current) => current.filter((lecture) => lecture.id !== deleteTarget.id));
    setDeleteTarget(null);
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

  async function handleRenameLecture() {
    if (!renameTarget) {
      return;
    }

    const currentTitle = renameTarget.title?.trim() || "Untitled note";
    const nextTitle = renameValue.trim();

    if (!nextTitle || nextTitle === currentTitle) {
      closeRenameModal();
      return;
    }

    setBusyLectureId(renameTarget.id);
    const response = await fetch(`/api/lectures/${renameTarget.id}`, {
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
        item.id === renameTarget.id
          ? {
              ...item,
              title: nextTitle,
            }
          : item,
      ),
    );
    setRenameTarget(null);
    setRenameValue("");
    startTransition(() => router.refresh());
  }

  const visibleLectures = selectedFolderLectureIdSet
    ? libraryLectures.filter((lecture) => selectedFolderLectureIdSet.has(lecture.id))
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
  const attachMenuRef = (node: HTMLDivElement | null) => {
    menuRef.current = node;
  };
  const toggleLectureMenu = (lectureId: string) => {
    setOpenMenuLectureId((current) => (current === lectureId ? null : lectureId));
  };

  return (
    <>
      <div className="home-dashboard pb-8">
        <section className="dashboard-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">New note</h2>
          </div>
          <p className="dashboard-section-lead">
            Record audio, upload audio, paste text or PDF, or add a link.
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
                      {lecture.error_message ?? "Retry the note or remove it from the library."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyLectureId === lecture.id}
                      onClick={() => openDeleteModal(lecture)}
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
                <NoteRow
                  key={lecture.id}
                  lecture={lecture}
                  isMenuOpen={openMenuLectureId === lecture.id}
                  isBusy={busyLectureId === lecture.id}
                  onToggleMenu={toggleLectureMenu}
                  onOpenRename={openRenameModal}
                  onOpenDelete={openDeleteModal}
                  attachMenuRef={attachMenuRef}
                />
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

      {renameTarget ? (
        <>
          <div className="ios-sheet-backdrop" onClick={closeRenameModal} aria-hidden="true" />
          <div className="ios-sheet-wrap" role="presentation">
            <div className="ios-sheet-stack">
              <section
                className="ios-sheet dashboard-note-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rename-note-title"
              >
                <div className="ios-sheet-header">
                  <h2 id="rename-note-title" className="ios-sheet-title">
                    Rename note
                  </h2>
                  <button
                    type="button"
                    className="app-close-button ios-sheet-header-close"
                    onClick={closeRenameModal}
                    aria-label="Close rename note dialog"
                    disabled={busyLectureId === renameTarget.id}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form
                  className="dashboard-note-dialog-body"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleRenameLecture();
                  }}
                >
                  <p className="ios-subtitle dashboard-note-dialog-copy">
                    Give this note a clearer title without leaving the page.
                  </p>

                  <label className="dashboard-note-dialog-field">
                    <span>Title</span>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      className="ios-input"
                      placeholder="Untitled note"
                    />
                  </label>

                  <div className="dashboard-note-dialog-actions">
                    <button
                      type="submit"
                      className="ios-primary-button"
                      disabled={
                        busyLectureId === renameTarget.id ||
                        !renameValue.trim() ||
                        renameValue.trim() === (renameTarget.title?.trim() || "Untitled note")
                      }
                    >
                      {busyLectureId === renameTarget.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Save title
                    </button>
                    <button
                      type="button"
                      className="ios-secondary-button"
                      onClick={closeRenameModal}
                      disabled={busyLectureId === renameTarget.id}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        </>
      ) : null}

      {deleteTarget ? (
        <>
          <div className="ios-sheet-backdrop" onClick={closeDeleteModal} aria-hidden="true" />
          <div className="ios-sheet-wrap" role="presentation">
            <div className="ios-sheet-stack">
              <section
                className="ios-sheet dashboard-note-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-note-title"
              >
                <div className="ios-sheet-header">
                  <h2 id="delete-note-title" className="ios-sheet-title">
                    Delete note
                  </h2>
                  <button
                    type="button"
                    className="app-close-button ios-sheet-header-close"
                    onClick={closeDeleteModal}
                    aria-label="Close delete note dialog"
                    disabled={busyLectureId === deleteTarget.id}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="dashboard-note-dialog-body">
                  <p className="ios-subtitle dashboard-note-dialog-copy">
                    Delete{" "}
                    <span className="dashboard-note-dialog-highlight">
                      {deleteTarget.title?.trim() || "Untitled note"}
                    </span>
                    ? This cannot be undone.
                  </p>

                  <div className="dashboard-note-dialog-actions">
                    <button
                      type="button"
                      className="dashboard-note-dialog-danger"
                      onClick={() => void handleDeleteLecture()}
                      disabled={busyLectureId === deleteTarget.id}
                    >
                      {busyLectureId === deleteTarget.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Delete note
                    </button>
                    <button
                      type="button"
                      className="ios-secondary-button"
                      onClick={closeDeleteModal}
                      disabled={busyLectureId === deleteTarget.id}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
