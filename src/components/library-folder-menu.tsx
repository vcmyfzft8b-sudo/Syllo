"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import { Folder } from "@/components/folder";
import { ViewportPortal } from "@/components/viewport-portal";
import type { AppLectureListItem } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

type LibraryFolder = {
  id: string;
  name: string;
  lectureIds: string[];
};

const LEGACY_FOLDERS_STORAGE_KEY = "nota-library-folders";
const FOLDERS_STORAGE_KEY_PREFIX = "nota-library-folders";
const SELECTED_FOLDER_STORAGE_KEY_PREFIX = "nota-selected-library-folder";

function getFoldersStorageKey(userId: string) {
  return `${FOLDERS_STORAGE_KEY_PREFIX}:${userId}`;
}

function getSelectedFolderStorageKey(userId: string) {
  return `${SELECTED_FOLDER_STORAGE_KEY_PREFIX}:${userId}`;
}

function parseStoredFolders(rawValue: string | null) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((folder): folder is LibraryFolder => {
      if (!folder || typeof folder !== "object") {
        return false;
      }

      const value = folder as Partial<LibraryFolder>;
      return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        Array.isArray(value.lectureIds) &&
        value.lectureIds.every((lectureId) => typeof lectureId === "string")
      );
    });
  } catch {
    return [];
  }
}

function readStoredFolders(userId: string) {
  if (typeof window === "undefined") {
    return [];
  }

  const userScopedKey = getFoldersStorageKey(userId);
  const userScopedFolders = parseStoredFolders(window.localStorage.getItem(userScopedKey));

  if (userScopedFolders.length > 0) {
    return userScopedFolders;
  }

  const legacyFolders = parseStoredFolders(window.localStorage.getItem(LEGACY_FOLDERS_STORAGE_KEY));

  if (legacyFolders.length > 0) {
    window.localStorage.setItem(userScopedKey, JSON.stringify(legacyFolders));
  }

  return legacyFolders;
}

function writeStoredFolders(userId: string, nextFolders: LibraryFolder[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getFoldersStorageKey(userId), JSON.stringify(nextFolders));
}

function readStoredSelectedFolderId(userId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(getSelectedFolderStorageKey(userId));
  return typeof value === "string" && value.length > 0 ? value : null;
}

function writeStoredSelectedFolderId(userId: string, folderId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getSelectedFolderStorageKey(userId);

  if (folderId) {
    window.localStorage.setItem(storageKey, folderId);
    return;
  }

  window.localStorage.removeItem(storageKey);
}

function createFolder(name: string, lectureIds: string[]) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    lectureIds,
  };
}

function toggleLectureId(currentIds: string[], lectureId: string) {
  return currentIds.includes(lectureId)
    ? currentIds.filter((id) => id !== lectureId)
    : [...currentIds, lectureId];
}

function lectureSummary(count: number) {
  if (count === 1) {
    return "1 predavanje";
  }

  return `${count} predavanj`;
}

export function LibraryFolderMenu({
  lectures,
  userId,
  selectedFolderId,
  onSelectFolder,
}: {
  lectures: AppLectureListItem[];
  userId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null, lectureIds: string[] | null) => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredSelectionRef = useRef(false);
  const folderSheetDragStartYRef = useRef<number | null>(null);
  const folderSheetDragOffsetRef = useRef(0);
  const folderSheetSuppressClickRef = useRef(false);
  const folderModalDragStartYRef = useRef<number | null>(null);
  const folderModalDragOffsetRef = useRef(0);
  const folderModalSuppressClickRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [folderSheetDragOffset, setFolderSheetDragOffset] = useState(0);
  const [folderModalDragOffset, setFolderModalDragOffset] = useState(0);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [folders, setFolders] = useState<LibraryFolder[]>(() => readStoredFolders(userId));
  const [folderName, setFolderName] = useState("");
  const [draftLectureIds, setDraftLectureIds] = useState<string[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingLectureIds, setEditingLectureIds] = useState<string[]>([]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const isEditModalOpen = editingFolderId !== null;

  function handleCancelEdit() {
    folderModalDragStartYRef.current = null;
    folderModalDragOffsetRef.current = 0;
    setFolderModalDragOffset(0);
    setEditingFolderId(null);
    setEditingName("");
    setEditingLectureIds([]);
  }

  useEffect(() => {
    if (hasRestoredSelectionRef.current) {
      return;
    }

    hasRestoredSelectionRef.current = true;

    const storedFolderId = readStoredSelectedFolderId(userId);

    if (!storedFolderId) {
      onSelectFolder(null, null);
      return;
    }

    const storedFolder = folders.find((folder) => folder.id === storedFolderId);

    if (!storedFolder) {
      writeStoredSelectedFolderId(userId, null);
      onSelectFolder(null, null);
      return;
    }

    onSelectFolder(storedFolder.id, storedFolder.lectureIds);
  }, [folders, onSelectFolder, userId]);

  useEffect(() => {
    writeStoredSelectedFolderId(userId, selectedFolderId);
  }, [selectedFolderId, userId]);

  useEffect(() => {
    if (!isOpen && !isCreateModalOpen && !isEditModalOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (isCreateModalOpen || isEditModalOpen) {
        return;
      }

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".library-folder-mobile-sheet")
      ) {
        return;
      }

      if (!shellRef.current?.contains(target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setIsCreateModalOpen(false);
        handleCancelEdit();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isCreateModalOpen, isEditModalOpen, isOpen]);

  useEffect(() => {
    if (!selectedFolderId) {
      return;
    }

    const nextSelectedFolder = folders.find((folder) => folder.id === selectedFolderId);

    if (!nextSelectedFolder) {
      writeStoredSelectedFolderId(userId, null);
      onSelectFolder(null, null);
    }
  }, [folders, onSelectFolder, selectedFolderId, userId]);

  function handleToggleMenu() {
    setIsOpen((currentValue) => !currentValue);
  }

  function closeCreateModal() {
    folderModalDragStartYRef.current = null;
    folderModalDragOffsetRef.current = 0;
    setFolderModalDragOffset(0);
    setIsCreateModalOpen(false);
  }

  const closeFolderSheet = useCallback(() => {
    folderSheetDragStartYRef.current = null;
    folderSheetDragOffsetRef.current = 0;
    setFolderSheetDragOffset(0);
    setIsOpen(false);
  }, []);

  const animateCloseFolderSheet = useCallback(() => {
    folderSheetDragStartYRef.current = null;
    folderSheetDragOffsetRef.current = window.innerHeight;
    setFolderSheetDragOffset(window.innerHeight);
    window.setTimeout(() => {
      closeFolderSheet();
    }, 180);
  }, [closeFolderSheet]);

  function handleFolderSheetPointerDown(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, a, input, textarea, select, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".library-folder-mobile-sheet-handle") : null;

    if (
      interactiveTarget &&
      !dragHandleTarget &&
      !(interactiveTarget as Element).closest(".library-folder-option")
    ) {
      return;
    }

    folderSheetSuppressClickRef.current = false;
    folderSheetDragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateFolderSheetDragOffset(clientY: number) {
    if (folderSheetDragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - folderSheetDragStartYRef.current);
    folderSheetDragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      folderSheetSuppressClickRef.current = true;
    }
    setFolderSheetDragOffset(nextOffset);
  }

  function handleFolderSheetClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!folderSheetSuppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    folderSheetSuppressClickRef.current = false;
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateFolderSheetDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (folderSheetDragOffsetRef.current > 80) {
        animateCloseFolderSheet();
        return;
      }

      folderSheetDragStartYRef.current = null;
      folderSheetDragOffsetRef.current = 0;
      setFolderSheetDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [animateCloseFolderSheet, isOpen]);

  function handleFolderModalPointerDown(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, a, input, textarea, select, label, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".library-folder-modal-drag-handle") : null;

    if (
      interactiveTarget &&
      !dragHandleTarget
    ) {
      return;
    }

    folderModalSuppressClickRef.current = false;
    folderModalDragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateFolderModalDragOffset(clientY: number) {
    if (folderModalDragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - folderModalDragStartYRef.current);
    folderModalDragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      folderModalSuppressClickRef.current = true;
    }
    setFolderModalDragOffset(nextOffset);
  }

  function handleFolderModalClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!folderModalSuppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    folderModalSuppressClickRef.current = false;
  }

  useEffect(() => {
    if (!isCreateModalOpen && !isEditModalOpen) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateFolderModalDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (folderModalDragOffsetRef.current > 80) {
        folderModalDragStartYRef.current = null;
        folderModalDragOffsetRef.current = window.innerHeight;
        setFolderModalDragOffset(window.innerHeight);
        if (isCreateModalOpen) {
          window.setTimeout(() => {
            closeCreateModal();
          }, 180);
          return;
        }

        window.setTimeout(() => {
          handleCancelEdit();
        }, 180);
        return;
      }

      folderModalDragStartYRef.current = null;
      folderModalDragOffsetRef.current = 0;
      setFolderModalDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [isCreateModalOpen, isEditModalOpen]);

  function handleSelectAllNotes() {
    onSelectFolder(null, null);
    closeFolderSheet();
  }

  function handleSelectFolder(folder: LibraryFolder) {
    onSelectFolder(folder.id, folder.lectureIds);
    closeFolderSheet();
  }

  function handleCreateFolder() {
    const trimmedName = folderName.trim();

    if (!trimmedName) {
      return;
    }

    const nextFolder = createFolder(trimmedName, draftLectureIds);
    const nextFolders = [...folders, nextFolder];

    setFolders(nextFolders);
    writeStoredFolders(userId, nextFolders);
    onSelectFolder(nextFolder.id, nextFolder.lectureIds);
    setFolderName("");
    setDraftLectureIds([]);
    closeCreateModal();
    setIsOpen(false);
  }

  function startEditingFolder(folder: LibraryFolder) {
    setEditingFolderId(folder.id);
    setEditingName(folder.name);
    setEditingLectureIds(folder.lectureIds);
  }

  function handleSaveFolder() {
    if (!editingFolderId) {
      return;
    }

    const trimmedName = editingName.trim();

    if (!trimmedName) {
      return;
    }

    const nextFolders = folders.map((folder) =>
      folder.id === editingFolderId
        ? {
            ...folder,
            name: trimmedName,
            lectureIds: editingLectureIds,
          }
        : folder,
    );

    setFolders(nextFolders);
    writeStoredFolders(userId, nextFolders);

    if (selectedFolderId === editingFolderId) {
      const nextSelectedFolder = nextFolders.find((folder) => folder.id === editingFolderId);
      onSelectFolder(nextSelectedFolder?.id ?? null, nextSelectedFolder?.lectureIds ?? null);
    }

    handleCancelEdit();
  }

  function handleDeleteFolder(folderId: string) {
    const nextFolders = folders.filter((folder) => folder.id !== folderId);
    setFolders(nextFolders);
    writeStoredFolders(userId, nextFolders);

    if (selectedFolderId === folderId) {
      onSelectFolder(null, null);
    }

    if (editingFolderId === folderId) {
      setEditingFolderId(null);
      setEditingName("");
      setEditingLectureIds([]);
    }
  }

  function handleOpenEditModal() {
    if (folders.length === 0) {
      return;
    }

    startEditingFolder(selectedFolder ?? folders[0]);
    setIsOpen(false);
  }

  function renderFolderMenuOptions() {
    return (
      <div className="library-folder-menu-primary">
      <div className="library-folder-actions">
        <button
          type="button"
          className={`library-folder-option library-folder-option-folder ${selectedFolderId === null ? "active" : ""}`}
          onClick={handleSelectAllNotes}
        >
          <span className="library-folder-option-copy">
            <span className="library-folder-option-icon">
              <Folder open={false} size={0.34} />
            </span>
            <span className="library-folder-option-text">
              <span>Vsi zapiski</span>
              <span className="library-folder-option-meta">
                {lectureSummary(lectures.length)}
              </span>
            </span>
          </span>
        </button>

        {folders.map((folder) => (
          <button
            type="button"
            key={folder.id}
            className={`library-folder-option library-folder-option-folder ${selectedFolderId === folder.id ? "active" : ""}`}
            onClick={() => handleSelectFolder(folder)}
          >
            <span className="library-folder-option-copy">
              <span className="library-folder-option-icon">
                <Folder open={false} size={0.34} />
              </span>
              <span className="library-folder-option-text">
                <span>{folder.name}</span>
                <span className="library-folder-option-meta">
                  {lectureSummary(folder.lectureIds.length)}
                </span>
              </span>
            </span>
          </button>
        ))}

        <div className="library-folder-menu-divider" />

        <button
          type="button"
          className="library-folder-option library-folder-option-action"
          onClick={() => {
            setFolderName("");
            setDraftLectureIds([]);
            setIsOpen(false);
            setIsCreateModalOpen(true);
          }}
        >
          <span className="library-folder-option-copy">
            <span className="library-folder-option-icon">
              <EmojiIcon symbol="➕" size="0.95rem" />
            </span>
            <span>Nova mapa</span>
          </span>
          <span className="library-folder-option-icon">
            <EmojiIcon symbol="›" size="1.1rem" />
          </span>
        </button>

        <button
          type="button"
          className="library-folder-option library-folder-option-action"
          onClick={handleOpenEditModal}
        >
          <span className="library-folder-option-copy">
            <span className="library-folder-option-icon">
              <EmojiIcon symbol="✏️" size="0.95rem" />
            </span>
            <span>Uredi mape</span>
          </span>
          <span className="library-folder-option-icon">
            <EmojiIcon symbol="›" size="1.1rem" />
          </span>
        </button>
      </div>
      </div>
    );
  }

  return (
    <div className="library-folder-shell" ref={shellRef}>
      <button
        type="button"
        className={`library-folder-trigger ${isOpen ? "open" : ""}`}
        onClick={handleToggleMenu}
        aria-expanded={isOpen}
      >
        <span className="library-folder-trigger-icon">
          <Folder open={isOpen} size={0.5} />
        </span>
        <span className="library-folder-trigger-label">
          {selectedFolder?.name ?? "Vsi zapiski"}
        </span>
        <EmojiIcon className={`library-folder-chevron ${isOpen ? "open" : ""}`} symbol="▾" size="0.95rem" />
      </button>

      {isOpen ? (
        <>
          <div className="library-folder-menu library-folder-menu-desktop">
            {renderFolderMenuOptions()}
          </div>
          <ViewportPortal>
            <div
              className="library-folder-mobile-sheet-backdrop"
              role="presentation"
              onClick={animateCloseFolderSheet}
            />
            <section
              className="library-folder-mobile-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="folders-sheet-title"
              onPointerDown={handleFolderSheetPointerDown}
              onClickCapture={handleFolderSheetClickCapture}
              style={
                folderSheetDragOffset > 0
                  ? { transform: `translateY(${folderSheetDragOffset}px)` }
                  : undefined
              }
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle library-folder-mobile-sheet-handle"
                aria-label="Povleci navzdol za zapiranje map"
              />
              <div className="library-folder-mobile-sheet-header">
                <h2 id="folders-sheet-title" className="library-folder-mobile-sheet-title">
                  Mape
                </h2>
                <button
                  type="button"
              className="app-close-button library-folder-mobile-sheet-close"
                  onClick={animateCloseFolderSheet}
                  aria-label="Zapri mape"
                >
                  <EmojiIcon symbol="✖️" size="1rem" />
                </button>
              </div>
              <div className="library-folder-mobile-sheet-body">
                {renderFolderMenuOptions()}
              </div>
            </section>
          </ViewportPortal>
        </>
      ) : null}

      {isCreateModalOpen ? (
        <ViewportPortal>
          <div
            className="library-folder-modal-overlay"
            role="presentation"
            onClick={closeCreateModal}
          >
            <div
              className="library-folder-modal mobile-draggable-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-folder-title"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={handleFolderModalPointerDown}
              onClickCapture={handleFolderModalClickCapture}
              style={
                folderModalDragOffset > 0
                  ? { transform: `translateY(${folderModalDragOffset}px)` }
                  : undefined
              }
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle library-folder-modal-drag-handle"
                aria-label="Povleci navzdol za zapiranje"
              />
              <button
                type="button"
                className="app-close-button library-folder-modal-close"
                onClick={closeCreateModal}
                aria-label="Zapri okno za novo mapo"
              >
                <EmojiIcon symbol="✖️" size="1rem" />
              </button>

              <div className="library-folder-modal-header">
                <h3 id="new-folder-title" className="library-folder-modal-title">
                  Nova mapa
                </h3>
                <div className="library-folder-modal-icon">
                  <Folder open size={1.35} />
                </div>
              </div>

              <div className="library-folder-modal-body">
                <label className="library-folder-modal-field">
                  <span>Ime</span>
                  <input
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    placeholder="Biologija, Matematika, Zgodovina..."
                    className="ios-input"
                  />
                </label>

                <div className="library-folder-modal-field">
                  <span>Dodaj predavanja</span>
                  <div className="library-folder-lecture-picker modal">
                    {lectures.length > 0 ? (
                      lectures.map((lecture) => (
                        <label key={lecture.id} className="library-folder-lecture-option">
                          <input
                            type="checkbox"
                            checked={draftLectureIds.includes(lecture.id)}
                            onChange={() =>
                              setDraftLectureIds((currentIds) =>
                                toggleLectureId(currentIds, lecture.id),
                              )
                            }
                          />
                          <span>
                            <span className="library-folder-lecture-title">
                              {lecture.title ?? "Neimenovan zapisek"}
                            </span>
                            <span className="library-folder-lecture-meta">
                              {formatRelativeDate(lecture.created_at)}
                            </span>
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="library-folder-empty">
                        Najprej ustvari zapiske, nato jih razporedi v mape.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="library-folder-primary-button modal"
                onClick={handleCreateFolder}
              >
                Ustvari
              </button>
            </div>
          </div>
        </ViewportPortal>
      ) : null}

      {isEditModalOpen ? (
        <ViewportPortal>
          <div
            className="library-folder-modal-overlay"
            role="presentation"
            onClick={handleCancelEdit}
          >
            <div
              className="library-folder-modal mobile-draggable-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-folder-title"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={handleFolderModalPointerDown}
              onClickCapture={handleFolderModalClickCapture}
              style={
                folderModalDragOffset > 0
                  ? { transform: `translateY(${folderModalDragOffset}px)` }
                  : undefined
              }
            >
            <button
              type="button"
              className="mobile-sheet-drag-handle library-folder-modal-drag-handle"
              aria-label="Povleci navzdol za zapiranje"
            />
            <button
              type="button"
              className="app-close-button library-folder-modal-close"
              onClick={handleCancelEdit}
              aria-label="Zapri okno za urejanje map"
            >
              <EmojiIcon symbol="✖️" size="1rem" />
            </button>

            <div className="library-folder-modal-header">
              <h3 id="edit-folder-title" className="library-folder-modal-title">
                Uredi mapo
              </h3>
              <div className="library-folder-modal-icon">
                <Folder open size={1.35} />
              </div>
            </div>

            <div className="library-folder-modal-body">
              {folders.length > 1 ? (
                <div className="library-folder-modal-field">
                  <span>Izberi mapo</span>
                  <div className="library-folder-modal-folder-list">
                    {folders.map((folder) => (
                      <button
                        type="button"
                        key={folder.id}
                        className={`library-folder-modal-folder-option ${editingFolderId === folder.id ? "active" : ""}`}
                        onClick={() => startEditingFolder(folder)}
                      >
                        <span>
                          <span className="library-folder-saved-title">{folder.name}</span>
                          <span className="library-folder-saved-meta">
                            {lectureSummary(folder.lectureIds.length)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="library-folder-modal-field">
                <span>Ime</span>
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="ios-input"
                />
              </label>

              <div className="library-folder-modal-field">
                <span>Dodaj predavanja</span>
                <div className="library-folder-lecture-picker modal">
                  {lectures.length > 0 ? (
                    lectures.map((lecture) => (
                      <label key={lecture.id} className="library-folder-lecture-option">
                        <input
                          type="checkbox"
                          checked={editingLectureIds.includes(lecture.id)}
                          onChange={() =>
                            setEditingLectureIds((currentIds) =>
                              toggleLectureId(currentIds, lecture.id),
                            )
                          }
                        />
                        <span>
                          <span className="library-folder-lecture-title">
                            {lecture.title ?? "Neimenovan zapisek"}
                          </span>
                          <span className="library-folder-lecture-meta">
                            {formatRelativeDate(lecture.created_at)}
                          </span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="library-folder-empty">
                      Najprej ustvari zapiske, nato jih razporedi v mape.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="library-folder-modal-actions">
              <button
                type="button"
                className="library-folder-primary-button modal"
                onClick={handleSaveFolder}
              >
                Shrani spremembe
              </button>
              <button
                type="button"
                className="library-folder-secondary-button"
                onClick={handleCancelEdit}
              >
                Prekliči
              </button>
              <button
                type="button"
                className="library-folder-danger-button"
                onClick={() => {
                  if (editingFolderId) {
                    handleDeleteFolder(editingFolderId);
                  }
                }}
              >
                <EmojiIcon symbol="🗑️" size="0.95rem" />
                Izbriši mapo
              </button>
            </div>
            </div>
          </div>
        </ViewportPortal>
      ) : null}
    </div>
  );
}
