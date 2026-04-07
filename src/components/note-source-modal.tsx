"use client";

import {
  ChevronLeft,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { EmojiIcon } from "@/components/emoji-icon";
import { LiveAudioWave } from "@/components/live-audio-wave";
import { ViewportPortal } from "@/components/viewport-portal";
import { createAudioLectureWithProcessingChunks } from "@/lib/audio-lecture-upload";
import {
  AUDIO_FILE_INPUT_ACCEPT,
  DOCUMENT_FILE_INPUT_ACCEPT,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MAX_DOCUMENT_BYTES,
  MAX_SCAN_IMAGE_BYTES,
  SCAN_IMAGE_INPUT_ACCEPT,
} from "@/lib/constants";
import { parseApiResponse, redirectToBillingIfNeeded } from "@/lib/billing-client";
import {
  createSafeTransportFileName,
  isSupportedDocumentFile,
} from "@/lib/document-files";
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
  { id: "record", label: "Snemaj" },
  { id: "upload", label: "Naloži" },
  { id: "text", label: "Dokumenti" },
  { id: "link", label: "Povezava" },
];

function pickRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const userAgent = window.navigator.userAgent;
  const prefersMp4Recording =
    /Safari/i.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|EdgiOS|FxiOS)/i.test(userAgent);
  const candidates = prefersMp4Recording
    ? [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ]
    : [
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
      reject(new Error("Dolžine zvočne datoteke ni bilo mogoče prebrati."));
    };
  });
}

function validateAudio(file: File, durationSeconds: number) {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Zvočna datoteka je prevelika. Omejitev je 300 MB.");
  }

  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error("Zvočna datoteka je predolga. Omejitev je 3 ure.");
  }
}

function sheetTitle(mode: NoteSourceMode) {
  if (mode === "record") {
    return "Posnemi predavanje";
  }

  if (mode === "upload") {
    return "Naloži zvok";
  }

  if (mode === "link") {
    return "Dodaj povezavo";
  }

  return "Prilepi besedilo ali dokument";
}

function sheetDescription() {
  return "";
}

export function NoteSourceModal({
  mode,
  open,
  onClose,
  canCreateNotes,
}: {
  mode: NoteSourceMode | null;
  open: boolean;
  onClose: () => void;
  canCreateNotes?: boolean;
}) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const requestCloseRef = useRef<() => void>(() => undefined);
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
  const [isPaused, setIsPaused] = useState(false);
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [textEditorKeyboardOffset, setTextEditorKeyboardOffset] = useState(0);
  const [scannedFileName, setScannedFileName] = useState<string | null>(null);
  const [visualizerStream, setVisualizerStream] = useState<MediaStream | null>(null);
  const [showAudioImportGuide, setShowAudioImportGuide] = useState(false);

  useEffect(() => {
    if (mode) {
      setSelectedMode(mode);
      setShowAudioImportGuide(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!open || canCreateNotes !== false) {
      return;
    }

    onClose();
    router.replace("/app/start");
  }, [canCreateNotes, onClose, open, router]);

  useEffect(() => {
    if (selectedMode !== "text" && isTextEditorOpen) {
      setIsTextEditorOpen(false);
    }
  }, [isTextEditorOpen, selectedMode]);

  useEffect(() => {
    if (!isTextEditorOpen || typeof window === "undefined") {
      setTextEditorKeyboardOffset(0);
      return;
    }

    const viewport = window.visualViewport;

    if (!viewport) {
      setTextEditorKeyboardOffset(0);
      return;
    }

    const updateKeyboardOffset = () => {
      const keyboardOffset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );

      setTextEditorKeyboardOffset(keyboardOffset > 120 ? keyboardOffset : 0);
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("orientationchange", updateKeyboardOffset);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("orientationchange", updateKeyboardOffset);
    };
  }, [isTextEditorOpen]);

  const preparedRecording = audioSource?.origin === "recording" ? audioSource : null;
  const preparedUpload = audioSource?.origin === "upload" ? audioSource : null;
  const trimmedTextValue = textValue.trim();
  const trimmedLinkValue = linkValue.trim();
  const canGenerateText = Boolean(pdfSource) || trimmedTextValue.length >= 120;
  const canGenerateLink = trimmedLinkValue.length > 0;

  function redirectToPaywall() {
    onClose();
    router.push("/app/start");
  }

  const replaceAudioSource = useCallback(async (nextSource: AudioSource) => {
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
          : "Zvoka ni bilo mogoče pripraviti.",
      );
    }
  }, [audioSource]);

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
    setVisualizerStream(null);
    chunksRef.current = [];
    elapsedRef.current = 0;
    clearAudioSource();
    setPdfSource(null);
    setTextValue("");
    setLinkValue("");
    setLanguageHint("sl");
    setIsRecording(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    setError(null);
    setBusyLabel(null);
    setIsCancelling(false);
    setIsTextEditorOpen(false);
    setScannedFileName(null);
    setShowAudioImportGuide(false);
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

      const payload = await parseApiResponse<{ lectureId: string }>(response);

      createdLectureIdRef.current = payload.lectureId;
      return payload.lectureId as string;
    },
    [languageHint],
  );

  const handleCancelBusyAction = useCallback(async () => {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    setIsCancelling(true);
    setBusyLabel((current) => current ?? "Preklicujem...");
    await deleteCreatedLecture();
    setBusyLabel(null);
    setIsCancelling(false);
    setError(null);
  }, [deleteCreatedLecture]);

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
        requestCloseRef.current();
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
  }, [open]);

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
          : "Datoteke ni bilo mogoče pripraviti.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function startRecording() {
    if (!canCreateNotes) {
      redirectToPaywall();
      return;
    }

    if (!recordingSupported) {
      setError("Ta brskalnik ne podpira snemanja znotraj aplikacije.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setVisualizerStream(stream);
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
        setVisualizerStream(null);
        setIsPaused(false);
      };

      recorder.start();
      setIsRecording(true);
      setIsPaused(false);
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
          : "Snemanja ni bilo mogoče začeti.",
      );
    }
  }

  const stopRecording = useCallback(async () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setIsPaused(false);
    setVisualizerStream(null);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state !== "recording") {
      return;
    }

    recorderRef.current.pause();
    setIsPaused(true);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state !== "paused") {
      return;
    }

    recorderRef.current.resume();
    setIsPaused(false);

    if (!timerRef.current) {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((value) => {
          const nextValue = value + 1;
          elapsedRef.current = nextValue;
          return nextValue;
        });
      }, 1000);
    }
  }, []);

  const requestClose = useCallback(() => {
    if (showAudioImportGuide) {
      setShowAudioImportGuide(false);
      return;
    }

    if (isTextEditorOpen) {
      setIsTextEditorOpen(false);
      return;
    }

    if (isRecording) {
      void stopRecording();
      return;
    }

    if (busyLabel) {
      void handleCancelBusyAction();
      return;
    }

    onClose();
  }, [
    busyLabel,
    handleCancelBusyAction,
    isRecording,
    isTextEditorOpen,
    onClose,
    showAudioImportGuide,
    stopRecording,
  ]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  async function createAudioLecture() {
    if (!audioSource) {
      setError("Najprej izberi ali posnemi zvok.");
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
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!processingStarted) {
        await deleteCreatedLecture();
      }

      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Zvočnega zapiska ni bilo mogoče ustvariti.",
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
      setError("Prilepi vsaj krajši vzorec besedila.");
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("text");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Ustvarjam zapiske...");

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

      await parseApiResponse<{ lectureId: string }>(response);

      onClose();
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Besedilnega zapiska ni bilo mogoče ustvariti.",
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
      setError("Najprej prilepi povezavo.");
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("link");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Berem stran...");

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

      await parseApiResponse<{ lectureId: string }>(response);

      onClose();
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Spletnega zapiska ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function handleScanImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canCreateNotes) {
      event.target.value = "";
      redirectToPaywall();
      return;
    }

    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      if (!file.type.startsWith("image/")) {
        throw new Error("Za skeniranje uporabi fotografijo ali sliko.");
      }

      if (file.size > MAX_SCAN_IMAGE_BYTES) {
        throw new Error("Slika za skeniranje je prevelika. Omejitev je 8 MB.");
      }

      setBusyLabel("Skeniram besedilo...");
      setError(null);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/lectures/scan", {
        method: "POST",
        body: formData,
      });

      const payload = await parseApiResponse<{ title?: string; text?: string }>(response);

      setPdfSource(null);
      setTextValue(payload.text ?? "");
      setScannedFileName(file.name);
      setIsTextEditorOpen(false);
    } catch (scanError) {
      if (redirectToBillingIfNeeded({ error: scanError, router })) {
        onClose();
        return;
      }

      setError(
        scanError instanceof Error ? scanError.message : "Fotografije ni bilo mogoče skenirati.",
      );
    } finally {
      setBusyLabel(null);
      event.target.value = "";
    }
  }

  async function handlePdfPick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canCreateNotes) {
      event.target.value = "";
      redirectToPaywall();
      return;
    }

    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      if (!isSupportedDocumentFile(file)) {
        throw new Error("Uporabi PDF, TXT, Markdown, HTML, RTF ali DOCX.");
      }

      if (file.size > MAX_DOCUMENT_BYTES) {
        throw new Error("Datoteka dokumenta je prevelika. Trenutna omejitev je 4 MB.");
      }

      setPdfSource(file);
      setTextValue("");
      setScannedFileName(null);
      setError(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Dokumenta ni bilo mogoče pripraviti.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function createPdfLecture() {
    if (!pdfSource) {
      setError("Najprej izberi dokument.");
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("pdf");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const uploadFileName = createSafeTransportFileName(pdfSource.name);
      const uploadFile =
        uploadFileName === pdfSource.name
          ? pdfSource
          : new File([pdfSource], uploadFileName, {
              type: pdfSource.type,
              lastModified: pdfSource.lastModified,
            });

      const formData = new FormData();
      formData.append("lectureId", lectureId);
      formData.append("file", uploadFile);
      formData.append("originalFileName", pdfSource.name);
      formData.append("languageHint", languageHint);

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Berem dokument...");

      const response = await fetch("/api/lectures/pdf", {
        method: "POST",
        signal: controller.signal,
        body: formData,
      });

      await parseApiResponse<{ lectureId: string }>(response);

      onClose();
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Zapiska iz dokumenta ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  function renderBusyOrGenerateButton(params: {
    canGenerate: boolean;
    onGenerate: () => void;
    generateIcon: string;
  }) {
    if (busyLabel) {
      return (
        <button
          type="button"
          className="ios-secondary-button"
          disabled={isCancelling}
          onClick={() => void handleCancelBusyAction()}
        >
          {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Prekliči
        </button>
      );
    }

    return (
      <button
        type="button"
        className="ios-primary-button"
        disabled={!params.canGenerate}
        onClick={() => {
          if (!canCreateNotes) {
            redirectToPaywall();
            return;
          }

          params.onGenerate();
        }}
      >
        <EmojiIcon symbol={params.generateIcon} size="1rem" />
        Ustvari
      </button>
    );
  }

  function renderLoadingState() {
    if (!busyLabel) {
      return null;
    }

    return (
      <div className="note-source-loading-state" aria-live="polite">
        <div className="note-source-busy-row">
          <Loader2 className="h-4 w-4 animate-spin note-source-loading-spinner" />
          <p className="note-source-busy-title">{busyLabel}</p>
        </div>
        <p className="note-source-busy-copy">
          Ne zapiraj tega zaslona. Ko bo vse pripravljeno, se bo zaprl samodejno.
        </p>
        <button
          type="button"
          className="ios-secondary-button"
          disabled={isCancelling}
          onClick={() => void handleCancelBusyAction()}
        >
          {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Prekliči
        </button>
      </div>
    );
  }

  if (!open || !mode) {
    return null;
  }

  const modalContent = (
    <>
      <div
        className="ios-sheet-backdrop note-source-modal-backdrop"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className="ios-sheet-wrap note-source-modal-wrap"
        role="dialog"
        aria-modal="true"
        aria-label="Nov zapisek"
      >
        <div className="ios-sheet-stack note-source-modal-stack">
          <section className="ios-sheet note-source-sheet note-source-modal">
            <div className="ios-sheet-header note-source-header">
              <div className="note-source-header-main">
                {showAudioImportGuide ? (
                  <button
                    type="button"
                    className="note-source-back-button"
                    onClick={() => setShowAudioImportGuide(false)}
                    disabled={Boolean(busyLabel) || isCancelling}
                    aria-label="Nazaj na možnosti zvoka"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Nazaj
                  </button>
                ) : null}
                <h2 className="ios-sheet-title">
                  {showAudioImportGuide ? "Uvozi zvok iz telefona" : sheetTitle(selectedMode)}
                </h2>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={isCancelling}
                className="app-close-button ios-sheet-header-close"
                aria-label="Zapri"
              >
                <EmojiIcon symbol="✖️" size="1rem" />
              </button>
            </div>

            {sheetDescription() ? (
              <p className="note-source-description">{sheetDescription()}</p>
            ) : null}

            {busyLabel ? (
              <div className="mt-6 note-source-modal-body note-source-modal-body-loading">
                {renderLoadingState()}
              </div>
            ) : showAudioImportGuide ? (
              <div className="mt-6 space-y-4 note-source-modal-body">
                <section className="ios-card note-source-guide-hero">
                  <p className="note-source-card-label">Zakaj to obstaja</p>
                  <p className="note-source-guide-title">
                    Posnemi predavanje, tudi ko je zaslon telefona ugasnjen, nato pa posnetek naloži kasneje.
                  </p>
                  <p className="note-source-guide-copy">
                    Snemanje znotraj aplikacije deluje le, dokler je ta aplikacija odprta. Pri daljših predavanjih je lažje, da najprej snemaš v privzeti aplikaciji telefona, nato posnetek premakneš v aplikacijo Datoteke in ga tukaj naložiš.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Korak 1</p>
                  <p className="note-source-guide-step-title">Posnemi v običajni aplikaciji za zvok na telefonu</p>
                  <p className="note-source-guide-copy">
                    Na iPhonu uporabi Voice Memos. Na Androidu uporabi Recorder ali katerokoli vgrajeno aplikacijo za snemanje, ki shrani datoteko na napravo.
                  </p>
                  <p className="note-source-guide-copy">
                    Snemanje tam zaženi pred začetkom predavanja. Telefon lahko zakleneš, ugasneš zaslon ali popolnoma zapreš to aplikacijo. Snemanje bo teklo v sistemski aplikaciji, ne v tej aplikaciji.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Korak 2</p>
                  <p className="note-source-guide-step-title">Premakni posnetek v aplikacijo Datoteke</p>
                  <p className="note-source-guide-copy">
                    Po predavanju odpri posnetek v aplikaciji za snemanje in poišči možnosti, kot so Deli, Izvozi, Shrani v Datoteke, Prenesi ali Kopiraj v Datoteke.
                  </p>
                  <p className="note-source-guide-copy">
                    Zvok shrani na mesto, ki ga boš hitro našel, na primer Prenosi, Na mojem iPhonu, iCloud Drive ali mapo Datoteke na Androidu. Če tvoj telefon ta korak poimenuje drugače, uporabi možnost, ki posnetek shrani kot datoteko.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Korak 3</p>
                  <p className="note-source-guide-step-title">Tukaj ga naloži prek izbirnika datotek</p>
                  <p className="note-source-guide-copy">
                    Vrni se v to aplikacijo, odpri potek za zvočni zapisek, preklopi na <strong>Naloži</strong>, pritisni <strong>Izberi zvočno datoteko</strong> in izberi posnetek, ki si ga shranil v Datoteke.
                  </p>
                  <p className="note-source-guide-copy">
                    Ko je datoteka izbrana, pritisni <strong>Ustvari</strong>. Aplikacija bo ta zvok predavanja pretvorila v zapiske in ostalo učno gradivo.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Na kratko</p>
                  <p className="note-source-guide-copy">
                    Za predavanje uporabi sistemski snemalnik. Zvok shrani v Datoteke. Nato ga tukaj v zavihku za nalaganje pretvori v zapiske.
                  </p>
                </section>
              </div>
            ) : (
              <>
                {!isRecording ? (
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
                ) : null}
                <div className="mt-6 space-y-4 note-source-modal-body">
                  {selectedMode === "record" && !isRecording ? (
                    <button
                      type="button"
                      className="ios-card note-source-guide-entry"
                      onClick={() => setShowAudioImportGuide(true)}
                    >
                      <div className="note-source-guide-entry-copy">
                        <p className="note-source-guide-entry-title">
                          Snemaj tudi z ugasnjenim telefonom
                        </p>
                        <p className="note-source-guide-entry-text">
                          Shrani posnetek in ga tukaj naloži kasneje.
                        </p>
                      </div>
                      <span className="note-source-guide-entry-arrow" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ) : null}

                  {!isRecording ? (
                    <div>
                      <label className="note-source-field-label">
                        Jezik
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
                  ) : null}

                  {selectedMode === "record" ? (
                    <>
                      {preparedRecording ? (
                        <div className="ios-card">
                          <p className="note-source-card-label">Pripravljen posnetek</p>
                          <p className="ios-row-title mt-3">{preparedRecording.file.name}</p>
                          <p className="ios-row-subtitle">
                            {formatTimestamp(preparedRecording.durationSeconds * 1000)}
                          </p>
                        </div>
                      ) : null}

                      {isRecording ? (
                        <div className="ios-card">
                          <p className="note-source-card-label">Snemanje</p>
                          <p className="ios-row-title mt-3">
                            {isPaused ? "Snemanje je začasno ustavljeno" : "Snemanje poteka"}
                          </p>
                          <p className="ios-row-subtitle">
                            {formatTimestamp(elapsedSeconds * 1000)}
                          </p>
                          <div className="mt-4 px-4 py-4 text-[var(--label)]">
                            <LiveAudioWave
                              stream={visualizerStream}
                              active={isRecording && !isPaused}
                              className="mx-auto max-w-[14rem]"
                            />
                          </div>
                        </div>
                      ) : null}

                      {isRecording ? (
                        <div className="note-source-recording-actions">
                          <button
                            type="button"
                            disabled={Boolean(busyLabel)}
                            className="ios-secondary-button"
                            onClick={() => {
                              if (busyLabel) {
                                return;
                              }

                              if (isPaused) {
                                resumeRecording();
                                return;
                              }

                              pauseRecording();
                            }}
                          >
                            <EmojiIcon symbol={isPaused ? "▶️" : "⏸️"} size="1rem" />
                            {isPaused ? "Nadaljuj snemanje" : "Začasno ustavi snemanje"}
                          </button>

                          <button
                            type="button"
                            disabled={Boolean(busyLabel)}
                            className="ios-primary-button"
                            onClick={() => {
                              if (busyLabel) {
                                return;
                              }

                              void stopRecording();
                            }}
                          >
                            {busyLabel ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <EmojiIcon symbol="🎙️" size="1rem" />
                            )}
                            {busyLabel ?? "Ustavi snemanje"}
                          </button>
                        </div>
                      ) : null}

                      {!isRecording && preparedRecording ? (
                        <>
                          {renderBusyOrGenerateButton({
                            canGenerate: true,
                            onGenerate: () => void createAudioLecture(),
                            generateIcon: "📄",
                          })}

                          <button
                            type="button"
                            className="ios-secondary-button"
                            disabled={Boolean(busyLabel)}
                            onClick={() => {
                              clearAudioSource();
                              void startRecording();
                            }}
                          >
                            Posnemi znova
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
                            <EmojiIcon symbol="🎙️" size="1rem" />
                          )}
                          {busyLabel ?? "Začni snemanje"}
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {selectedMode === "upload" ? (
                    <>
                      {preparedUpload ? (
                        <div className="ios-card">
                          <p className="note-source-card-label">Izbrana datoteka</p>
                          <p className="ios-row-title mt-3">{preparedUpload.file.name}</p>
                          <p className="ios-row-subtitle">
                            {formatTimestamp(preparedUpload.durationSeconds * 1000)}
                          </p>
                        </div>
                      ) : null}

                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept={AUDIO_FILE_INPUT_ACCEPT}
                        onChange={handleUploadFileChange}
                        className="hidden"
                      />

                      <button
                        type="button"
                        disabled={Boolean(busyLabel)}
                        className="ios-secondary-button"
                          onClick={() => {
                            if (!canCreateNotes) {
                              redirectToPaywall();
                              return;
                            }

                            uploadInputRef.current?.click();
                          }}
                      >
                        <EmojiIcon symbol="📤" size="1rem" />
                        {preparedUpload ? "Izberi drugo zvočno datoteko" : "Izberi zvočno datoteko"}
                      </button>

                      {renderBusyOrGenerateButton({
                        canGenerate: Boolean(preparedUpload),
                        onGenerate: () => void createAudioLecture(),
                        generateIcon: "📄",
                      })}
                    </>
                  ) : null}

                  {selectedMode === "link" ? (
                    <>
                      <div>
                        <label className="note-source-field-label">
                          Povezava
                        </label>
                        <div className="ios-search">
                          <EmojiIcon symbol="🔎" size="0.95rem" />
                          <input
                            value={linkValue}
                            onChange={(event) => setLinkValue(event.target.value)}
                            placeholder="https://example.com"
                          />
                        </div>
                      </div>

                      {renderBusyOrGenerateButton({
                        canGenerate: canGenerateLink,
                        onGenerate: () => void createLinkLecture(),
                        generateIcon: "🔗",
                      })}
                    </>
                  ) : null}

                  {selectedMode === "text" ? (
                    <>
                      {pdfSource ? (
                        <div className="ios-card note-source-docs-file-card">
                          <p className="note-source-card-label">Izbran dokument</p>
                          <p className="ios-row-title note-source-docs-file-name">{pdfSource.name}</p>
                          <p className="ios-row-subtitle note-source-docs-file-copy">
                            Uporabljen bo, dokler ponovno ne začneš tipkati.
                          </p>
                        </div>
                      ) : null}

                      {!pdfSource && scannedFileName ? (
                        <div className="ios-card note-source-docs-file-card">
                          <p className="note-source-card-label">Skenirano besedilo je pripravljeno</p>
                          <p className="ios-row-title note-source-docs-file-name">{scannedFileName}</p>
                          <p className="ios-row-subtitle note-source-docs-file-copy">
                            Pred ustvarjanjem zapiskov preglej in uredi izluščeno besedilo.
                          </p>
                        </div>
                      ) : null}

                      <div className="note-source-docs-textarea-wrap">
                        <textarea
                          value={textValue}
                          onChange={(event) => {
                            const nextValue = event.target.value;

                            if (pdfSource && nextValue.trim().length > 0) {
                              setPdfSource(null);
                            }

                            if (nextValue.trim().length === 0) {
                              setScannedFileName(null);
                            }

                            setTextValue(nextValue);
                          }}
                          className="ios-textarea note-source-inline-textarea"
                          placeholder="Sem prilepi zapiske ali besedilo..."
                        />
                      </div>

                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept={DOCUMENT_FILE_INPUT_ACCEPT}
                        onChange={handlePdfPick}
                        className="hidden"
                      />

                      <input
                        ref={scanInputRef}
                        type="file"
                        accept={SCAN_IMAGE_INPUT_ACCEPT}
                        capture="environment"
                        onChange={handleScanImageChange}
                        className="hidden"
                      />

                      <div className="note-source-docs-actions note-source-docs-actions-bottom">
                        <button
                          type="button"
                          className="ios-secondary-button note-source-docs-action-button"
                          disabled={Boolean(busyLabel)}
                          onClick={() => {
                            if (!canCreateNotes) {
                              redirectToPaywall();
                              return;
                            }

                            pdfInputRef.current?.click();
                          }}
                        >
                          <EmojiIcon symbol="📤" size="1rem" />
                          Datoteka
                        </button>

                        <button
                          type="button"
                          className="ios-secondary-button note-source-docs-action-button"
                          disabled={Boolean(busyLabel)}
                          onClick={() => {
                            if (!canCreateNotes) {
                              redirectToPaywall();
                              return;
                            }

                            scanInputRef.current?.click();
                          }}
                        >
                          <EmojiIcon symbol="📷" size="1rem" />
                          Skeniraj
                        </button>
                      </div>

                      {renderBusyOrGenerateButton({
                        canGenerate: canGenerateText,
                        onGenerate: () => {
                          if (pdfSource) {
                            void createPdfLecture();
                            return;
                          }

                          void createTextLecture();
                        },
                        generateIcon: "📄",
                      })}
                    </>
                  ) : null}

                  {error ? <p className="ios-info ios-danger">{error}</p> : null}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {selectedMode === "text" && isTextEditorOpen ? (
        <>
          <div
            className="ios-sheet-backdrop note-source-subsheet-backdrop"
            onClick={() => setIsTextEditorOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`ios-sheet-wrap note-source-subsheet-wrap ${
              textEditorKeyboardOffset > 0 ? "keyboard-open" : ""
            }`}
            style={
              {
                "--text-editor-keyboard-offset": `${textEditorKeyboardOffset}px`,
              } as CSSProperties
            }
            role="presentation"
          >
            <div className="ios-sheet-stack note-source-subsheet-stack">
              <section
                className="ios-sheet dashboard-note-dialog note-source-subsheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="paste-text-title"
              >
                <div className="ios-sheet-header">
                  <h2 id="paste-text-title" className="ios-sheet-title">
                    Prilepi besedilo
                  </h2>
                  <button
                    type="button"
                    className="app-close-button ios-sheet-header-close"
                    onClick={() => setIsTextEditorOpen(false)}
                    aria-label="Zapri okno za lepljenje besedila"
                    disabled={Boolean(busyLabel)}
                  >
                    <EmojiIcon symbol="✖️" size="1rem" />
                  </button>
                </div>

                <div className="dashboard-note-dialog-body">
                  <p className="ios-subtitle dashboard-note-dialog-copy">
                    Sem prilepi zapiske predavanja, prosojnice, besedilo članka ali preglej skenirano besedilo.
                  </p>

                  <textarea
                    value={textValue}
                    onChange={(event) => {
                      const nextValue = event.target.value;

                      if (pdfSource && nextValue.trim().length > 0) {
                        setPdfSource(null);
                      }

                      if (nextValue.trim().length === 0) {
                        setScannedFileName(null);
                      }

                      setTextValue(nextValue);
                    }}
                    className="ios-textarea note-source-subsheet-textarea"
                    placeholder="Prilepi vsebino predavanja ali članka..."
                    autoFocus
                  />

                  <div className="dashboard-note-dialog-actions">
                    <button
                      type="button"
                      className="ios-primary-button"
                      disabled={Boolean(busyLabel)}
                      onClick={() => setIsTextEditorOpen(false)}
                    >
                      Končano
                    </button>
                    {textValue.trim().length > 0 ? (
                      <button
                        type="button"
                        className="ios-secondary-button"
                        disabled={Boolean(busyLabel)}
                        onClick={() => {
                          setTextValue("");
                          setScannedFileName(null);
                        }}
                      >
                        Počisti besedilo
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </>
  );

  return <ViewportPortal>{modalContent}</ViewportPortal>;
}
