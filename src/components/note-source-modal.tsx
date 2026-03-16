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

import { BRAND_NAME } from "@/lib/brand";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, STORAGE_BUCKET } from "@/lib/constants";
import { getExtensionForMimeType, normalizeMimeType } from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatTimestamp } from "@/lib/utils";

export type NoteSourceMode = "record" | "link" | "text" | "upload";

type AudioSource = {
  file: File;
  durationSeconds: number;
  previewUrl: string;
  origin: "upload" | "recording";
};

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "sl", label: "Slovenian" },
  { value: "de", label: "German" },
  { value: "hr", label: "Croatian" },
  { value: "it", label: "Italian" },
];

const MODES: Array<{
  id: NoteSourceMode;
  label: string;
}> = [
  { id: "record", label: "Record" },
  { id: "upload", label: "Upload" },
  { id: "link", label: "Link" },
  { id: "text", label: "Text" },
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

  const recordingMimeType = useMemo(() => pickRecorderMimeType(), []);

  const [selectedMode, setSelectedMode] = useState<NoteSourceMode>(mode ?? "record");
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [textValue, setTextValue] = useState("");
  const [linkValue, setLinkValue] = useState("");
  const [languageHint, setLanguageHint] = useState("en");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingSupported, setRecordingSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  useEffect(() => {
    if (mode) {
      setSelectedMode(mode);
    }
  }, [mode]);

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
    setAudioSource((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
    setTextValue("");
    setLinkValue("");
    setLanguageHint("en");
    setIsRecording(false);
    setElapsedSeconds(0);
    setError(null);
    setBusyLabel(null);
  }, []);

  const requestClose = useCallback(() => {
    if (busyLabel) {
      return;
    }

    if (isRecording) {
      stopRecording();
    }

    onClose();
  }, [busyLabel, isRecording, onClose]);

  useEffect(() => {
    setRecordingSupported(typeof window !== "undefined" && "MediaRecorder" in window);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
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

    try {
      const normalizedMimeType = normalizeMimeType(audioSource.file.type || "audio/webm");

      setBusyLabel("Preparing...");
      setError(null);

      const createResponse = await fetch("/api/lectures", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mimeType: normalizedMimeType,
          size: audioSource.file.size,
          durationSeconds: Math.max(audioSource.durationSeconds, 1),
          languageHint,
        }),
      });

      const createData = await createResponse.json();

      if (!createResponse.ok) {
        throw new Error(createData.error ?? "The lecture could not be created.");
      }

      setBusyLabel("Uploading audio...");
      const supabase = createSupabaseBrowserClient();
      const uploadResult = await supabase.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(createData.path, createData.token, audioSource.file, {
          contentType: normalizedMimeType,
          upsert: true,
        });

      if (uploadResult.error) {
        throw new Error(uploadResult.error.message);
      }

      setBusyLabel("Starting processing...");
      const finalizeResponse = await fetch(`/api/lectures/${createData.lectureId}/finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: createData.path,
        }),
      });

      const finalizeData = await finalizeResponse.json();

      if (!finalizeResponse.ok) {
        throw new Error(finalizeData.error ?? "The audio could not be sent for processing.");
      }

      onClose();
      router.push(`/app/lectures/${createData.lectureId}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The audio note could not be created.",
      );
    } finally {
      setBusyLabel(null);
    }
  }

  async function createTextLecture() {
    if (textValue.trim().length < 120) {
      setError("Paste at least a short text sample.");
      return;
    }

    try {
      setBusyLabel("Creating notes...");
      setError(null);

      const response = await fetch("/api/lectures/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: textValue,
          languageHint,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The text could not be processed.");
      }

      onClose();
      router.push(`/app/lectures/${payload.lectureId}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The text note could not be created.",
      );
    } finally {
      setBusyLabel(null);
    }
  }

  async function createLinkLecture() {
    if (!linkValue.trim()) {
      setError("Paste a link first.");
      return;
    }

    try {
      setBusyLabel("Reading page...");
      setError(null);

      const response = await fetch("/api/lectures/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: linkValue,
          languageHint,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The link could not be processed.");
      }

      onClose();
      router.push(`/app/lectures/${payload.lectureId}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The web note could not be created.",
      );
    } finally {
      setBusyLabel(null);
    }
  }

  async function handlePdfPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setBusyLabel("Reading PDF...");
      setError(null);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("languageHint", languageHint);

      const response = await fetch("/api/lectures/pdf", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The PDF could not be processed.");
      }

      onClose();
      router.push(`/app/lectures/${payload.lectureId}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The PDF note could not be created.",
      );
    } finally {
      setBusyLabel(null);
      event.target.value = "";
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
                disabled={Boolean(busyLabel)}
                className="app-close-button ios-sheet-header-close"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="note-source-description">{sheetDescription(selectedMode)}</p>

            <div className="mt-6 ios-segmented">
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
                <div className="relative">
                  <select
                    value={languageHint}
                    onChange={(event) => setLanguageHint(event.target.value)}
                    className="ios-select appearance-none pr-10"
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
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
                  {audioSource ? (
                    <div className="ios-card">
                      <p className="note-source-card-label">Prepared recording</p>
                      <p className="ios-row-title mt-3">{audioSource.file.name}</p>
                      <p className="ios-row-subtitle">
                        {formatTimestamp(audioSource.durationSeconds * 1000)}
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

                  <button
                    type="button"
                    disabled={Boolean(busyLabel)}
                    className="ios-primary-button"
                    onClick={() => {
                      if (busyLabel) {
                        return;
                      }

                      if (isRecording) {
                        stopRecording();
                        return;
                      }

                      if (audioSource) {
                        void createAudioLecture();
                        return;
                      }

                      void startRecording();
                    }}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                    {busyLabel ??
                      (isRecording
                        ? "Stop recording"
                        : audioSource
                          ? "Create notes"
                          : "Start recording")}
                  </button>
                </>
              ) : null}

              {selectedMode === "upload" ? (
                <>
                  {audioSource ? (
                    <div className="ios-card">
                      <p className="note-source-card-label">Selected file</p>
                      <p className="ios-row-title mt-3">{audioSource.file.name}</p>
                      <p className="ios-row-subtitle">
                        {formatTimestamp(audioSource.durationSeconds * 1000)}
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
                    className="ios-primary-button"
                    onClick={() => {
                      if (busyLabel) {
                        return;
                      }

                      if (audioSource) {
                        void createAudioLecture();
                        return;
                      }

                      uploadInputRef.current?.click();
                    }}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UploadCloud className="h-4 w-4" />
                    )}
                    {busyLabel ?? (audioSource ? "Create notes" : "Choose file")}
                  </button>
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
                    disabled={Boolean(busyLabel)}
                    onClick={() => void createLinkLecture()}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    {busyLabel ?? "Create notes"}
                  </button>
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
                      onChange={(event) => setTextValue(event.target.value)}
                      className="ios-textarea"
                      placeholder="Paste lecture or article content..."
                    />
                  </div>

                  <button
                    type="button"
                    className="ios-primary-button"
                    disabled={Boolean(busyLabel)}
                    onClick={() => void createTextLecture()}
                  >
                    {busyLabel ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="h-4 w-4" />
                    )}
                    {busyLabel ?? "Create notes"}
                  </button>

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
                    Use PDF instead of text
                  </button>
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
