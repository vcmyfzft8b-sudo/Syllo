"use client";

import {
  Loader2,
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
import { EmojiIcon } from "@/components/emoji-icon";
import { LibraryFolderMenu } from "@/components/library-folder-menu";
import { InstantLink } from "@/components/instant-link";
import { ViewportPortal } from "@/components/viewport-portal";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import type { AppLectureListItem } from "@/lib/types";
import { formatCalendarDate } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    id: "record" as const,
    label: "Posnemi predavanje",
    detail: "Začni z enim dotikom",
    icon: "🎙️",
    accent: "record",
  },
  {
    id: "upload" as const,
    label: "Naloži zvok",
    detail: "MP3, M4A, WAV ali WEBM",
    icon: "📤",
    accent: "default",
  },
  {
    id: "text" as const,
    label: "Prilepi besedilo ali PDF",
    detail: "Pretvori gradivo v strukturirane zapiske",
    icon: "📄",
    accent: "default",
  },
  {
    id: "link" as const,
    label: "Dodaj povezavo",
    detail: "Spletni članek ali vir",
    icon: "🔗",
    accent: "default",
  },
] as const;

function sourceLabel(sourceType: string) {
  if (sourceType === "link") {
    return "Povezava";
  }

  if (sourceType === "text") {
    return "Besedilo";
  }

  if (sourceType === "pdf") {
    return "PDF";
  }

  return "Zvok";
}

function SourceIcon({ sourceType }: { sourceType: string }) {
  if (sourceType === "link") {
    return <EmojiIcon symbol="🔗" size="1rem" />;
  }

  if (sourceType === "text" || sourceType === "pdf") {
    return <EmojiIcon symbol="📄" size="1rem" />;
  }

  return <EmojiIcon symbol="🎙️" size="1rem" />;
}

function shouldPollLectureStatus(status: AppLectureListItem["status"]) {
  return (
    status === "uploading" ||
    status === "queued" ||
    status === "transcribing" ||
    status === "generating_notes"
  );
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
      <InstantLink
        href={`/app/lectures/${lecture.id}`}
        className="ios-row-note-card-link"
      >
        <div className="ios-row-icon" style={{ backgroundColor: "var(--surface-muted)" }}>
          <SourceIcon sourceType={lecture.source_type} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="ios-row-title truncate font-medium">{lecture.title ?? "Neimenovan zapisek"}</p>
          <p className="ios-row-subtitle mt-1">
            {sourceLabel(lecture.source_type)} • {formatCalendarDate(lecture.created_at)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lecture.status !== "ready" && <StatusBadge status={lecture.status} />}
        </div>
      </InstantLink>

      <div ref={isMenuOpen ? attachMenuRef : undefined} className="dashboard-note-actions">
        <button
          type="button"
          aria-label={`Odpri dejanja za ${lecture.title ?? "zapisek"}`}
          aria-expanded={isMenuOpen}
          disabled={isBusy}
          onClick={() => onToggleMenu(lecture.id)}
          className={`dashboard-note-menu-button ${isMenuOpen ? "open" : ""}`}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <EmojiIcon symbol="⋯" size="1rem" />
          )}
        </button>

        {isMenuOpen ? (
          <div className="dashboard-note-menu">
            <button
              type="button"
              onClick={() => onOpenRename(lecture)}
              className="dashboard-note-menu-item"
              aria-label="Preimenuj zapisek"
              title="Preimenuj zapisek"
            >
              <EmojiIcon symbol="✏️" size="0.95rem" />
              <span>Preimenuj</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenDelete(lecture)}
              className="dashboard-note-menu-item danger"
              aria-label="Izbriši zapisek"
              title="Izbriši zapisek"
            >
              <EmojiIcon symbol="🗑️" size="0.95rem" />
              <span>Izbriši</span>
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
  userId,
  canCreateNotes,
  hasPaidAccess,
  hasTrialLectureAvailable,
  trialLectureId,
  trialChatMessagesRemaining,
}: {
  lectures: AppLectureListItem[];
  userId: string;
  canCreateNotes: boolean;
  hasPaidAccess: boolean;
  hasTrialLectureAvailable: boolean;
  trialLectureId: string | null;
  trialChatMessagesRemaining: number;
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
    if (!libraryLectures.some((lecture) => shouldPollLectureStatus(lecture.status))) {
      return;
    }

    let cancelled = false;

    const refresh = () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }

      startTransition(() => router.refresh());
    };

    const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [libraryLectures, router]);

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
    setRenameValue(lecture.title?.trim() || "Neimenovan zapisek");
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

    const currentTitle = renameTarget.title?.trim() || "Neimenovan zapisek";
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
        {!hasPaidAccess ? (
          <section className="dashboard-section">
            <div style={{ padding: "0.1rem 0" }}>
              <p className="dashboard-overline">Brezplačen preizkus</p>
              <p className="ios-row-title mt-2">
                {hasTrialLectureAvailable ? "Na voljo imaš 1 brezplačen zapisek" : "Tvoj brezplačni zapisek je že porabljen"}
              </p>
              <p className="ios-row-subtitle mt-2">
                {hasTrialLectureAvailable
                  ? "Vključuje zapiske, kartice, kviz, preizkus znanja in 5 sporočil v klepetu."
                  : trialLectureId
                    ? `Tvoj poskusni zapisek ostane v knjižnici. Preostalih brezplačnih sporočil v klepetu: ${trialChatMessagesRemaining}.`
                    : "Nadgradi za ustvarjanje novega gradiva."}
              </p>
              {!canCreateNotes ? (
                <button
                  type="button"
                  className="app-home-highlight-link"
                  onClick={() => router.push("/app/start")}
                >
                  <span>Nadgradi za nov zapisek</span>
                  <EmojiIcon symbol="›" size="1.1rem" />
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="dashboard-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">Nov zapisek</h2>
          </div>

          <div className="note-action-grid">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  if (!canCreateNotes) {
                    router.push("/app/start");
                    return;
                  }

                  setManualModal(action.id);
                }}
                className="note-action-card"
              >
                <span
                  className={`note-action-card-icon ${
                    action.accent === "record" ? "record" : ""
                  }`}
                >
                  <EmojiIcon symbol={action.icon} size="1.2rem" />
                </span>
                <span className="note-action-card-copy">
                  <span className="note-action-card-label">{action.label}</span>
                  <span className="note-action-card-detail">{action.detail}</span>
                </span>
                <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-section mt-4">
          <div className="dashboard-section-heading mb-4">
            <h2 className="dashboard-section-title">Moji zapiski</h2>
          </div>

          <div className="dashboard-toolbar library-toolbar">
            <LibraryFolderMenu
              lectures={libraryLectures}
              userId={userId}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(folderId, lectureIds) => {
                setSelectedFolderId(folderId);
                setSelectedFolderLectureIds(lectureIds);
              }}
            />

            <div className="ios-search notes-search">
              <EmojiIcon symbol="🔎" size="0.95rem" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Išči po naslovu"
              />
            </div>
          </div>

          {failedLectures.length > 0 ? (
            <div className="dashboard-subsection">
              <div className="dashboard-subsection-heading">
                <h3 className="dashboard-subsection-title">Potrebno pozornosti</h3>
              </div>

              {failedLectures.map((lecture) => (
                <div key={lecture.id} className="dashboard-alert-card">
                  <div className="ios-row-icon" style={{ backgroundColor: "var(--red-soft)", color: "var(--red)", width: "2rem", height: "2rem" }}>
                    <EmojiIcon symbol="⚠️" size="1rem" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="ios-row-title text-[var(--red)] font-medium">
                      {lecture.error_message ? "Napaka pri obdelavi zapiska" : "Napaka pri ustvarjanju zapiska"}
                    </p>
                    <p className="ios-row-subtitle mt-1" style={{ fontSize: "0.8rem", color: "var(--label)" }}>
                      {lecture.error_message ?? "Poskusi znova ali odstrani zapisek iz knjižnice."}
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
                      Izbriši
                    </button>
                    {lecture.status === "failed" ? (
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
                        Poskusi znova
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
                <EmojiIcon symbol="📝" size="1.25rem" />
              </div>
              <p className="ios-row-title">
                {search
                  ? "Ni ujemajočih zapiskov"
                  : selectedFolderId
                    ? "Ta mapa je prazna"
                    : "Tvoja knjižnica je prazna"}
              </p>
              <p className="ios-row-subtitle mt-2">
                {search
                  ? "Poskusi krajši iskalni izraz ali počisti iskanje."
                  : selectedFolderId
                    ? "Dodaj predavanja v to mapo ali se vrni na vse zapiske."
                    : "Začni s posnetkom, zvočno datoteko, PDF-jem, besedilom ali povezavo."}
              </p>
              {!search && !selectedFolderId ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!canCreateNotes) {
                      router.push("/app/start");
                      return;
                    }

                    setManualModal("record");
                  }}
                  className="app-home-highlight-link"
                >
                  <span>Ustvari svoj prvi zapisek</span>
                  <EmojiIcon symbol="›" size="1.1rem" />
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <NoteSourceModal
        mode={activeModal}
        open={Boolean(activeModal)}
        onClose={closeModal}
        canCreateNotes={canCreateNotes}
      />

      {renameTarget ? (
        <ViewportPortal>
          <>
            <div
              className="ios-sheet-backdrop dashboard-note-dialog-backdrop"
              onClick={closeRenameModal}
              aria-hidden="true"
            />
            <div className="ios-sheet-wrap dashboard-note-dialog-wrap" role="presentation">
              <div className="ios-sheet-stack">
                <section
                  className="ios-sheet dashboard-note-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="rename-note-title"
                >
                  <div className="ios-sheet-header">
                    <h2 id="rename-note-title" className="ios-sheet-title">
                      Preimenuj zapisek
                    </h2>
                    <button
                      type="button"
                      className="app-close-button ios-sheet-header-close"
                      onClick={closeRenameModal}
                      aria-label="Zapri okno za preimenovanje zapiska"
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
                      Daj temu zapisku bolj jasen naslov, ne da zapustiš stran.
                    </p>

                    <label className="dashboard-note-dialog-field">
                      <span>Naslov</span>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        className="ios-input"
                        placeholder="Neimenovan zapisek"
                      />
                    </label>

                    <div className="dashboard-note-dialog-actions">
                      <button
                        type="submit"
                        className="ios-primary-button"
                        disabled={
                          busyLectureId === renameTarget.id ||
                          !renameValue.trim() ||
                          renameValue.trim() === (renameTarget.title?.trim() || "Neimenovan zapisek")
                        }
                      >
                        {busyLectureId === renameTarget.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Shrani naslov
                      </button>
                      <button
                        type="button"
                        className="ios-secondary-button"
                        onClick={closeRenameModal}
                        disabled={busyLectureId === renameTarget.id}
                      >
                        Prekliči
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            </div>
          </>
        </ViewportPortal>
      ) : null}

      {deleteTarget ? (
        <ViewportPortal>
          <>
            <div
              className="ios-sheet-backdrop dashboard-note-dialog-backdrop"
              onClick={closeDeleteModal}
              aria-hidden="true"
            />
            <div className="ios-sheet-wrap dashboard-note-dialog-wrap" role="presentation">
              <div className="ios-sheet-stack">
                <section
                  className="ios-sheet dashboard-note-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="delete-note-title"
                >
                  <div className="ios-sheet-header">
                    <h2 id="delete-note-title" className="ios-sheet-title">
                      Izbriši zapisek
                    </h2>
                    <button
                      type="button"
                      className="app-close-button ios-sheet-header-close"
                      onClick={closeDeleteModal}
                      aria-label="Zapri okno za brisanje zapiska"
                      disabled={busyLectureId === deleteTarget.id}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="dashboard-note-dialog-body">
                    <p className="ios-subtitle dashboard-note-dialog-copy">
                      Izbriši{" "}
                      <span className="dashboard-note-dialog-highlight">
                        {deleteTarget.title?.trim() || "Neimenovan zapisek"}
                      </span>
                      ? Tega ni mogoče razveljaviti.
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
                        Izbriši zapisek
                      </button>
                      <button
                        type="button"
                        className="ios-secondary-button"
                        onClick={closeDeleteModal}
                        disabled={busyLectureId === deleteTarget.id}
                      >
                        Prekliči
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </>
        </ViewportPortal>
      ) : null}
    </>
  );
}
