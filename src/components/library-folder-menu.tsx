"use client";

import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Folder } from "@/components/folder";
import type { AppLectureListItem } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

type LibraryFolder = {
  id: string;
  name: string;
  lectureIds: string[];
};

const STORAGE_KEY = "nota-library-folders";

function readStoredFolders() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

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

function writeStoredFolders(nextFolders: LibraryFolder[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextFolders));
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
    return "1 lecture";
  }

  return `${count} lectures`;
}

export function LibraryFolderMenu({
  lectures,
  selectedFolderId,
  onSelectFolder,
}: {
  lectures: AppLectureListItem[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null, lectureIds: string[] | null) => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [folders, setFolders] = useState<LibraryFolder[]>(() => readStoredFolders());
  const [folderName, setFolderName] = useState("");
  const [draftLectureIds, setDraftLectureIds] = useState<string[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingLectureIds, setEditingLectureIds] = useState<string[]>([]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const isEditModalOpen = editingFolderId !== null;

  useEffect(() => {
    if (!isOpen && !isCreateModalOpen && !isEditModalOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (isCreateModalOpen || isEditModalOpen) {
        return;
      }

      if (!shellRef.current?.contains(event.target as Node)) {
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
      onSelectFolder(null, null);
    }
  }, [folders, onSelectFolder, selectedFolderId]);

  function handleToggleMenu() {
    setIsOpen((currentValue) => !currentValue);
  }

  function handleSelectAllNotes() {
    onSelectFolder(null, null);
    setIsOpen(false);
  }

  function handleSelectFolder(folder: LibraryFolder) {
    onSelectFolder(folder.id, folder.lectureIds);
    setIsOpen(false);
  }

  function handleCreateFolder() {
    const trimmedName = folderName.trim();

    if (!trimmedName) {
      return;
    }

    const nextFolder = createFolder(trimmedName, draftLectureIds);
    const nextFolders = [...folders, nextFolder];

    setFolders(nextFolders);
    writeStoredFolders(nextFolders);
    onSelectFolder(nextFolder.id, nextFolder.lectureIds);
    setFolderName("");
    setDraftLectureIds([]);
    setIsCreateModalOpen(false);
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
    writeStoredFolders(nextFolders);

    if (selectedFolderId === editingFolderId) {
      const nextSelectedFolder = nextFolders.find((folder) => folder.id === editingFolderId);
      onSelectFolder(nextSelectedFolder?.id ?? null, nextSelectedFolder?.lectureIds ?? null);
    }

    handleCancelEdit();
  }

  function handleCancelEdit() {
    setEditingFolderId(null);
    setEditingName("");
    setEditingLectureIds([]);
  }

  function handleDeleteFolder(folderId: string) {
    const nextFolders = folders.filter((folder) => folder.id !== folderId);
    setFolders(nextFolders);
    writeStoredFolders(nextFolders);

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

  return (
    <div className="library-folder-shell" ref={shellRef}>
      <button
        type="button"
        className={`library-folder-trigger ${isOpen ? "open" : ""}`}
        onClick={handleToggleMenu}
      >
        <span className="library-folder-trigger-icon">
          <Folder open={isOpen} size={0.5} />
        </span>
        <span className="library-folder-trigger-label">
          {selectedFolder?.name ?? "All Notes"}
        </span>
        <ChevronDown className={`library-folder-chevron ${isOpen ? "open" : ""}`} />
      </button>

      {isOpen ? (
        <div className="library-folder-menu">
          <div className="library-folder-menu-primary">
            <div className="library-folder-actions">
              <button
                type="button"
                className={`library-folder-option ${selectedFolderId === null ? "active" : ""}`}
                onClick={handleSelectAllNotes}
              >
                <span className="library-folder-option-copy">
                  <span className="library-folder-option-icon">
                    <Folder open={false} size={0.34} />
                  </span>
                  <span>All Notes</span>
                </span>
                {selectedFolderId === null ? <Check className="h-4 w-4" /> : null}
              </button>

              {folders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  className={`library-folder-option ${selectedFolderId === folder.id ? "active" : ""}`}
                  onClick={() => handleSelectFolder(folder)}
                >
                  <span className="library-folder-option-copy">
                    <span className="library-folder-option-icon">
                      <Folder open={false} size={0.34} />
                    </span>
                    <span>{folder.name}</span>
                  </span>
                  {selectedFolderId === folder.id ? <Check className="h-4 w-4" /> : null}
                </button>
              ))}

              <div className="library-folder-menu-divider" />

              <button
                type="button"
                className="library-folder-option"
                onClick={() => {
                  setFolderName("");
                  setDraftLectureIds([]);
                  setIsOpen(false);
                  setIsCreateModalOpen(true);
                }}
              >
                <span className="library-folder-option-copy">
                  <Plus className="h-4 w-4" />
                  <span>New folder</span>
                </span>
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                className="library-folder-option"
                onClick={handleOpenEditModal}
              >
                <span className="library-folder-option-copy">
                  <Pencil className="h-4 w-4" />
                  <span>Edit folders</span>
                </span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateModalOpen ? (
        <div
          className="library-folder-modal-overlay"
          role="presentation"
          onClick={() => setIsCreateModalOpen(false)}
        >
          <div
            className="library-folder-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-folder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="app-close-button library-folder-modal-close"
              onClick={() => setIsCreateModalOpen(false)}
              aria-label="Close new folder dialog"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="library-folder-modal-header">
              <h3 id="new-folder-title" className="library-folder-modal-title">
                New Folder
              </h3>
              <div className="library-folder-modal-icon">
                <Folder open size={1.35} />
              </div>
            </div>

            <div className="library-folder-modal-body">
              <label className="library-folder-modal-field">
                <span>Name</span>
                <input
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="Biology, Maths, History..."
                  className="ios-input"
                />
              </label>

              <div className="library-folder-modal-field">
                <span>Add lectures</span>
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
                            {lecture.title ?? "Untitled note"}
                          </span>
                          <span className="library-folder-lecture-meta">
                            {formatRelativeDate(lecture.created_at)}
                          </span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="library-folder-empty">
                      Create notes first, then group them into folders.
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
              Create
            </button>
          </div>
        </div>
      ) : null}

      {isEditModalOpen ? (
        <div
          className="library-folder-modal-overlay"
          role="presentation"
          onClick={handleCancelEdit}
        >
          <div
            className="library-folder-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-folder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="app-close-button library-folder-modal-close"
              onClick={handleCancelEdit}
              aria-label="Close edit folder dialog"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="library-folder-modal-header">
              <h3 id="edit-folder-title" className="library-folder-modal-title">
                Edit Folder
              </h3>
              <div className="library-folder-modal-icon">
                <Folder open size={1.35} />
              </div>
            </div>

            <div className="library-folder-modal-body">
              {folders.length > 1 ? (
                <div className="library-folder-modal-field">
                  <span>Choose folder</span>
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
                        {editingFolderId === folder.id ? <Check className="h-4 w-4" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="library-folder-modal-field">
                <span>Name</span>
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="ios-input"
                />
              </label>

              <div className="library-folder-modal-field">
                <span>Add lectures</span>
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
                            {lecture.title ?? "Untitled note"}
                          </span>
                          <span className="library-folder-lecture-meta">
                            {formatRelativeDate(lecture.created_at)}
                          </span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="library-folder-empty">
                      Create notes first, then group them into folders.
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
                Save changes
              </button>
              <button
                type="button"
                className="library-folder-secondary-button"
                onClick={handleCancelEdit}
              >
                Cancel
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
                <Trash2 className="h-4 w-4" />
                Delete folder
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
