"use client";

import {
  ChevronDown,
  FileUp,
  Link2,
  Loader2,
  Mic,
  Search,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createAudioLectureWithProcessingChunks } from "@/lib/audio-lecture-upload";
import { BRAND_NAME } from "@/lib/brand";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MAX_PDF_BYTES,
} from "@/lib/constants";
import { NOTE_LANGUAGE_OPTIONS } from "@/lib/languages";
import { getExtensionForMimeType, normalizeMimeType } from "@/lib/storage";
import { formatTimestamp } from "@/lib/utils";

export type NoteSourceMode = "record" | "link" | "text" | "upload";

type AudioSource = {
  file: File;
  durationSeconds: number;
  previewUrl: string;
  origin: "upload" | "recording";
};

const MODES: Array<{
  id: NoteSourceMode;
  label: string;
}> = [
  { id: "record", label: "Record" },
  { id: "upload", label: "Upload" },
  { id: "text", label: "PDF" },
  { id: "link", label: "Link" },
];

function pickRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function readAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audio.remove();
    };

    audio.preload = "metadata";
    audio.src = objectUrl;

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(duration);
    };

    audio.onerror = () => {
      cleanup();
      reject(new Error("The audio duration could not be read."));
    };
  });
}

function validateAudio(file: File, durationSeconds: number) {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("The audio file is too large. The limit is 150 MB.");
  }

  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error("The audio file is too long. The limit is 2 hours.");
  }
}

function sheetTitle(mode: NoteSourceMode) {
  if (mode === "record") {
    return "Record lecture";
  }

  if (mode === "upload") {
    return "Upload audio";
  }

  if (mode === "link") {
    return "Add link";
  }

  return "Paste text or PDF";
}

function sheetDescription(mode: NoteSourceMode) {
  if (mode === "record") {
    return `Capture audio and let ${BRAND_NAME} turn it into a transcript, summary, and notes.`;
  }

  if (mode === "upload") {
    return "Turn an existing recording into organized notes.";
  }

  if (mode === "link") {
    return "Create notes from a web article or source.";
  }

  return `Paste source material or use a PDF and let ${BRAND_NAME} structure it for you.`;
}

export function NoteSourceModal({
  mode,
  open,
  onClose,
}: {
  mode: NoteSourceMode | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const createdLectureIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const recordingMimeType = useMemo(() => pickRecorderMimeType(), []);

  const [selectedMode, setSelectedMode] = useState<NoteSourceMode>(mode ?? "record");
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [pdfSource, setPdfSource] = useState<File | null>(null);
  const [textValue, setTextValue] = useState("");
  const [linkValue, setLinkValue] = useState("");
  const [languageHint, setLanguageHint] = useState("sl");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingSupported, setRecordingSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    if (mode) {
      setSelectedMode(mode);
    }
  }, [mode]);

  const preparedRecording = audioSource?.origin === "recording" ? audioSource : null;
  const preparedUpload = audioSource?.origin === "upload" ? audioSource : null;
  const trimmedTextValue = textValue.trim();
  const trimmedLinkValue = linkValue.trim();
  const canGenerateText = Boolean(pdfSource) || trimmedTextValue.length >= 120;
  const canGenerateLink = trimmedLinkValue.length > 0;

  async function replaceAudioSource(nextSource: AudioSource) {
    try {
      validateAudio(nextSource.file, nextSource.durationSeconds);

      if (audioSource?.previewUrl) {
        URL.revokeObjectURL(audioSource.previewUrl);
      }

      setAudioSource(nextSource);
      setError(null);
    } catch (validationError) {
      URL.revokeObjectURL(nextSource.previewUrl);
      setAudioSource(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "The audio could not be prepared.",
      );
    }
  }

  const clearAudioSource = useCallback(() => {
    setAudioSource((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }, []);

  const resetState = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    recorderRef.current = null;
    chunksRef.current = [];
    elapsedRef.current = 0;
    clearAudioSource();
    setPdfSource(null);
    setTextValue("");
    setLinkValue("");
    setLanguageHint("sl");
    setIsRecording(false);
    setElapsedSeconds(0);
    setError(null);
    setBusyLabel(null);
    setIsCancelling(false);
    activeRequestControllerRef.current = null;
    createdLectureIdRef.current = null;
    cancelRequestedRef.current = false;
  }, [clearAudioSource]);

  const deleteCreatedLecture = useCallback(async () => {
    const lectureId = createdLectureIdRef.current;

    if (!lectureId) {
      return;
    }

    await fetch(`/api/lectures/${lectureId}`, {
      method: "DELETE",
    }).catch(() => null);
    createdLectureIdRef.current = null;
  }, []);

  const createManualLecture = useCallback(
    async (sourceType: "text" | "pdf" | "link") => {
      const controller = new AbortController();
      activeRequestControllerRef.current = controller;

      const response = await fetch("/api/lectures/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          sourceType,
          languageHint,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The note could not be created.");
      }

      createdLectureIdRef.current = payload.lectureId;
      return payload.lectureId as string;
    },
    [languageHint],
  );

  const handleCancelBusyAction = useCallback(async () => {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    setIsCancelling(true);
    setBusyLabel((current) => current ?? "Cancelling...");
    await deleteCreatedLecture();
    setBusyLabel(null);
    setIsCancelling(false);
    setError("Creation cancelled.");
  }, [deleteCreatedLecture]);

  const requestClose = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }

    if (busyLabel) {
      void handleCancelBusyAction();
      return;
    }

    onClose();
  }, [busyLabel, handleCancelBusyAction, isRecording, onClose]);

  useEffect(() => {
    setRecordingSupported(typeof window !== "undefined" && "MediaRecorder" in window);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    return () => {
      if (audioSource?.previewUrl) {
        URL.revokeObjectURL(audioSource.previewUrl);
      }
    };
  }, [audioSource]);

  async function handleUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const durationSeconds = await readAudioDuration(file);
      await replaceAudioSource({
        file,
        durationSeconds,
        previewUrl: URL.createObjectURL(file),
        origin: "upload",
      });
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The file could not be prepared.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function startRecording() {
    if (!recordingSupported) {
      setError("This browser does not support in-app recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(
        stream,
        recordingMimeType ? { mimeType: recordingMimeType } : undefined,
      );

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const normalizedMimeType = normalizeMimeType(
          recorder.mimeType || blob.type || "audio/webm",
        );
        const extension = getExtensionForMimeType(normalizedMimeType);
        const file = new File([blob], `recording-${Date.now()}.${extension}`, {
          type: normalizedMimeType,
        });

        await replaceAudioSource({
          file,
          durationSeconds: elapsedRef.current,
          previewUrl: URL.createObjectURL(blob),
          origin: "recording",
        });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      recorder.start();
      setIsRecording(true);
      setElapsedSeconds(0);
      elapsedRef.current = 0;
      setError(null);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((value) => {
          const nextValue = value + 1;
          elapsedRef.current = nextValue;
          return nextValue;
        });
      }, 1000);
    } catch (recordError) {
      setError(
        recordError instanceof Error
          ? recordError.message
          : "Recording could not be started.",
      );
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function createAudioLecture() {
    if (!audioSource) {
      setError("Choose or record audio first.");
      return;
    }

    let processingStarted = false;

    try {
      const createController = new AbortController();
      activeRequestControllerRef.current = createController;

      setError(null);
      cancelRequestedRef.current = false;
      const result = await createAudioLectureWithProcessingChunks({
        file: audioSource.file,
        durationSeconds: Math.max(audioSource.durationSeconds, 1),
        languageHint,
        signal: createController.signal,
        onLectureCreated: (lectureId) => {
          createdLectureIdRef.current = lectureId;
        },
        onStageChange: (_stage, message) => {
          setBusyLabel(message);
        },
      });

      processingStarted = true;
      createdLectureIdRef.current = null;
      onClose();
      router.push(`/app/lectures/${result.lectureId}`);
      router.refresh();
    } catch (submitError) {
      if (!processingStarted) {
        await deleteCreatedLecture();
      }

      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "The audio note could not be created.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createTextLecture() {
    if (trimmedTextValue.length < 120) {
      setError("Paste at least a short text sample.");
      return;
    }

    try {
      setBusyLabel("Preparing...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("text");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Creating notes...");

      const response = await fetch("/api/lectures/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          lectureId,
          text: trimmedTextValue,
          languageHint,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The text could not be processed.");
      }

      onClose();
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "The text note could not be created.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createLinkLecture() {
    if (!trimmedLinkValue) {
      setError("Paste a link first.");
      return;
    }

    try {
      setBusyLabel("Preparing...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("link");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Reading page...");

      const response = await fetch("/api/lectures/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          lectureId,
          url: trimmedLinkValue,
          languageHint,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The link could not be processed.");
      }

      onClose();
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "The web note could not be created.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function handlePdfPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      if (!file.type.includes("pdf")) {
        throw new Error("Only PDF files are supported.");
      }

      if (file.size > MAX_PDF_BYTES) {
        throw new Error("The PDF file is too large. The current limit is 4 MB.");
      }

      setPdfSource(file);
      setTextValue("");
      setError(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The PDF could not be prepared.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function createPdfLecture() {
    if (!pdfSource) {
      setError("Choose a PDF first.");
      return;
    }

    try {
      setBusyLabel("Preparing...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("pdf");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const formData = new FormData();
      formData.append("lectureId", lectureId);
      formData.append("file", pdfSource);
      formData.append("languageHint", languageHint);

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Reading PDF...");

      const response = await fetch("/api/lectures/pdf", {
        method: "POST",
        signal: controller.signal,
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The PDF could not be processed.");
      }

      onClose();
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "The PDF note could not be created.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  if (!open || !mode) {
    return null;
  }

  return (
    <>
      <div className="ios-sheet-backdrop" onClick={requestClose} aria-hidden="true" />
      <div
        className="ios-sheet-wrap note-source-modal-wrap"
        role="dialog"
        aria-modal="true"
        aria-label="New note"
      >
        <div className="ios-sheet-stack note-source-modal-stack">
          <section className="ios-sheet note-source-sheet note-source-modal">
            <div className="ios-sheet-header note-source-header">
              <h2 className="ios-sheet-title">
                {sheetTitle(selectedMode)}
              </h2>
              <button
                type="button"
                onClick={requestClose}
                disabled={isCancelling}
                className="app-close-button ios-sheet-header-close"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="note-source-description">{sheetDescription(selectedMode)}</p>

            <div className="mt-6 ios-segmented note-source-segmented">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedMode(item.id)}
                  className={`ios-segment ${selectedMode === item.id ? "active" : ""}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-4 note-source-modal-body">
              <div>
                <label className="note-source-field-label">
                  Language
                </label>
                <div className="relative note-source-select-wrap">
                  <select
                    value={languageHint}
                    onChange={(event) => setLanguageHint(event.target.value)}
                    className="ios-select appearance-none pr-10"
                  >
                    {NOTE_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--secondary-label)]" />
                </div>
              </div>

              {selectedMode === "record" ? (
                <>
                  {preparedRecording ? (
                    <div className="ios-card">
                      <p className="note-source-card-label">Prepared recording</p>
                      <p className="ios-row-title mt-3">{preparedRecording.file.name}</p>
                      <p className="ios-row-subtitle">
                        {formatTimestamp(preparedRecording.durationSeconds * 1000)}
                      </p>
                    </div>
                  ) : null}

                  {isRecording ? (
                    <div className="ios-card">
                      <p className="note-source-card-label">Recording</p>
                      <p className="ios-row-title mt-3">Recording in progress</p>
                      <p className="ios-row-subtitle">
                        {formatTimestamp(elapsedSeconds * 1000)}
                      </p>
                    </div>
                  ) : null}

                  {isRecording ? (
                    <button
                      type="button"
                      disabled={Boolean(busyLabel)}
                      className="ios-primary-button"
                      onClick={() => {
                        if (busyLabel) {
                          return;
                        }

                        stopRecording();
                      }}
                    >
                      {busyLabel ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                      {busyLabel ?? "Stop recording"}
                    </button>
                  ) : null}

                  {!isRecording && preparedRecording ? (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(busyLabel)}
                        className="ios-primary-button"
                        onClick={() => void createAudioLecture()}
                      >
                        {busyLabel ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="h-4 w-4" />
                        )}
                        {busyLabel ?? "Generate"}
                      </button>
                      {busyLabel ? (
                        <button
                          type="button"
                          className="ios-secondary-button"
                          disabled={isCancelling}
                          onClick={() => void handleCancelBusyAction()}
                        >
                          {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Cancel
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="ios-secondary-button"
                        disabled={Boolean(busyLabel)}
                        onClick={() => {
                          clearAudioSource();
                          void startRecording();
                        }}
                      >
                        Record again
                      </button>
                    </>
                  ) : null}

                  {!isRecording && !preparedRecording ? (
                    <button
                      type="button"
                      disabled={Boolean(busyLabel)}
                      className="ios-primary-button"
                      onClick={() => void startRecording()}
                    >
                      {busyLabel ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                      {busyLabel ?? "Start recording"}
                    </button>
                  ) : null}
                </>
              ) : null}

              {selectedMode === "upload" ? (
                <>
                  {preparedUpload ? (
                    <div className="ios-card">
                      <p className="note-source-card-label">Selected file</p>
                      <p className="ios-row-title mt-3">{preparedUpload.file.name}</p>
                      <p className="ios-row-subtitle">
                        {formatTimestamp(preparedUpload.durationSeconds * 1000)}
                      </p>
                    </div>
                  ) : null}

                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleUploadFileChange}
                    className="hidden"
                  />

                  <button
                    type="button"
                    disabled={Boolean(busyLabel)}
                    className="ios-secondary-button"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    <UploadCloud className="h-4 w-4" />
                    {preparedUpload ? "Choose another audio file" : "Choose audio file"}
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busyLabel) || !preparedUpload}
                    className="ios-primary-button"
                    onClick={() => void createAudioLecture()}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="h-4 w-4" />
                    )}
                    {busyLabel ?? "Generate"}
                  </button>
                  {busyLabel ? (
                    <button
                      type="button"
                      className="ios-secondary-button"
                      disabled={isCancelling}
                      onClick={() => void handleCancelBusyAction()}
                    >
                      {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Cancel
                    </button>
                  ) : null}
                </>
              ) : null}

              {selectedMode === "link" ? (
                <>
                  <div>
                    <label className="note-source-field-label">
                      Link
                    </label>
                    <div className="ios-search">
                      <Search className="h-4 w-4 text-[var(--secondary-label)]" />
                      <input
                        value={linkValue}
                        onChange={(event) => setLinkValue(event.target.value)}
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="ios-primary-button"
                    disabled={Boolean(busyLabel) || !canGenerateLink}
                    onClick={() => void createLinkLecture()}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    {busyLabel ?? "Generate"}
                  </button>
                  {busyLabel ? (
                    <button
                      type="button"
                      className="ios-secondary-button"
                      disabled={isCancelling}
                      onClick={() => void handleCancelBusyAction()}
                    >
                      {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Cancel
                    </button>
                  ) : null}
                </>
              ) : null}

              {selectedMode === "text" ? (
                <>
                  <div>
                    <label className="note-source-field-label">
                      Text
                    </label>
                    <textarea
                      value={textValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;

                        if (pdfSource && nextValue.trim().length > 0) {
                          setPdfSource(null);
                        }

                        setTextValue(nextValue);
                      }}
                      className="ios-textarea"
                      placeholder="Paste lecture or article content..."
                    />
                  </div>

                  {pdfSource ? (
                    <div className="ios-card">
                      <p className="note-source-card-label">Selected PDF</p>
                      <p className="ios-row-title mt-3">{pdfSource.name}</p>
                      <p className="ios-row-subtitle">
                        PDF will be used until you start typing text again.
                      </p>
                    </div>
                  ) : null}

                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handlePdfPick}
                    className="hidden"
                  />

                  <button
                    type="button"
                    className="ios-secondary-button"
                    disabled={Boolean(busyLabel)}
                    onClick={() => pdfInputRef.current?.click()}
                  >
                    <UploadCloud className="h-4 w-4" />
                    {pdfSource ? "Choose another PDF file" : "Choose PDF file"}
                  </button>

                  <p className="ios-row-subtitle">
                    PDF uploads are currently limited to 4 MB.
                  </p>

                  <button
                    type="button"
                    className="ios-primary-button"
                    disabled={Boolean(busyLabel) || !canGenerateText}
                    onClick={() => {
                      if (pdfSource) {
                        void createPdfLecture();
                        return;
                      }

                      void createTextLecture();
                    }}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="h-4 w-4" />
                    )}
                    {busyLabel ?? "Generate"}
                  </button>
                  {busyLabel ? (
                    <button
                      type="button"
                      className="ios-secondary-button"
                      disabled={isCancelling}
                      onClick={() => void handleCancelBusyAction()}
                    >
                      {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Cancel
                    </button>
                  ) : null}
                </>
              ) : null}

              {error ? <p className="ios-info ios-danger">{error}</p> : null}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
