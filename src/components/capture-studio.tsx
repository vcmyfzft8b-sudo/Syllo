"use client";

import { Loader2, Mic, PauseCircle, UploadCloud, Waves } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createAudioLectureWithProcessingChunks } from "@/lib/audio-lecture-upload";
import { AUDIO_FILE_INPUT_ACCEPT, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "@/lib/constants";
import { getExtensionForMimeType, normalizeMimeType } from "@/lib/storage";
import { cn, formatTimestamp } from "@/lib/utils";
import { LiveAudioWave } from "@/components/live-audio-wave";

type CaptureSource = {
  file: File;
  durationSeconds: number;
  previewUrl: string;
  origin: "upload" | "recording";
};

type CaptureMode = "record" | "upload";

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
      reject(new Error("Dolžine posnetka ni bilo mogoče prebrati."));
    };
  });
}

function validateAudio(file: File, durationSeconds: number) {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Posnetek je prevelik. Trenutna omejitev je 300 MB.");
  }

  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error("Posnetek je predolg. Trenutna omejitev je 3 ure.");
  }
}

export function CaptureStudio({
  initialMode = "record",
}: {
  initialMode?: CaptureMode;
}) {
  const router = useRouter();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const createdLectureIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState<CaptureSource | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(initialMode);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordingSupported, setRecordingSupported] = useState<boolean | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [visualizerStream, setVisualizerStream] = useState<MediaStream | null>(null);
  const [stage, setStage] = useState<
    "idle" | "creating" | "uploading" | "finalizing"
  >("idle");
  const [isCancelling, setIsCancelling] = useState(false);

  const recordingMimeType = useMemo(() => pickRecorderMimeType(), []);

  useEffect(() => {
    setRecordingSupported(typeof window !== "undefined" && "MediaRecorder" in window);
  }, []);

  useEffect(() => {
    setCaptureMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      setVisualizerStream(null);
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (source?.previewUrl) {
        URL.revokeObjectURL(source.previewUrl);
      }
    };
  }, [source]);

  async function setNewSource(nextSource: CaptureSource) {
    try {
      validateAudio(nextSource.file, nextSource.durationSeconds);
      setSource(nextSource);
      setError(null);
    } catch (validationError) {
      if (nextSource.previewUrl) {
        URL.revokeObjectURL(nextSource.previewUrl);
      }

      setSource(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Neveljaven posnetek.",
      );
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const durationSeconds = await readAudioDuration(file);
      setCaptureMode("upload");
      await setNewSource({
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
    if (!recordingSupported) {
      setError("Ta brskalnik ne podpira snemanja znotraj aplikacije.");
      return;
    }

    if (!consent) {
      setError("Pred začetkom potrdi dovoljenje za snemanje.");
      return;
    }

    try {
      setCaptureMode("record");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setVisualizerStream(stream);
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, recordingMimeType ? { mimeType: recordingMimeType } : undefined);
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

        const file = new File([blob], `lecture-${Date.now()}.${extension}`, {
          type: normalizedMimeType,
        });

        const previewUrl = URL.createObjectURL(blob);
        await setNewSource({
          file,
          durationSeconds: elapsedRef.current,
          previewUrl,
          origin: "recording",
        });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        setVisualizerStream(null);
      };

      recorder.start();
      setElapsedSeconds(0);
      elapsedRef.current = 0;
      setIsRecording(true);
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

  async function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setVisualizerStream(null);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleSubmit() {
    if (!consent) {
      setError("Pred nalaganjem potrdi dovoljenje za snemanje in obdelavo.");
      return;
    }

    if (!source) {
      setError("Najprej naloži ali posnemi zvok.");
      return;
    }

    let processingStarted = false;

    try {
      const createController = new AbortController();
      activeRequestControllerRef.current = createController;

      setIsUploading(true);
      setError(null);
      cancelRequestedRef.current = false;
      const result = await createAudioLectureWithProcessingChunks({
        file: source.file,
        durationSeconds: Math.max(source.durationSeconds, 1),
        languageHint: "sl",
        signal: createController.signal,
        onLectureCreated: (lectureId) => {
          createdLectureIdRef.current = lectureId;
        },
        onStageChange: (nextStage) => {
          setStage(
            nextStage === "creating"
              ? "creating"
              : nextStage === "finalizing"
                ? "finalizing"
                : "uploading",
          );
          setError(null);
        },
      });

      processingStarted = true;
      createdLectureIdRef.current = null;
      router.push(`/app/lectures/${result.lectureId}`);
      router.refresh();
    } catch (submitError) {
      if (createdLectureIdRef.current && !processingStarted) {
        await fetch(`/api/lectures/${createdLectureIdRef.current}`, {
          method: "DELETE",
        }).catch(() => null);
        createdLectureIdRef.current = null;
      }

      if (!cancelRequestedRef.current) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Obdelave ni bilo mogoče začeti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setIsUploading(false);
      setStage("idle");
      setIsCancelling(false);
    }
  }

  async function handleCancelUpload() {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    setIsCancelling(true);

    if (createdLectureIdRef.current) {
      await fetch(`/api/lectures/${createdLectureIdRef.current}`, {
        method: "DELETE",
      }).catch(() => null);
      createdLectureIdRef.current = null;
    }

    setIsUploading(false);
    setStage("idle");
    setIsCancelling(false);
    setError("Ustvarjanje je preklicano.");
  }

  return (
    <div className="space-y-6">
      <section className="surface-card-strong p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setCaptureMode("record")}
            className={`rounded-[24px] border px-5 py-5 text-left transition ${
              captureMode === "record"
                ? "border-blue-200 bg-[var(--brand-soft)] shadow-[0_10px_24px_rgba(0,113,227,0.08)]"
                : "border-stone-200 bg-white hover:border-stone-300"
            }`}
          >
            <div
              className={`inline-flex rounded-[18px] p-3 ${
                captureMode === "record"
                  ? "bg-white text-rose-500"
                  : "bg-stone-100 text-stone-500"
              }`}
            >
              <Mic className="h-5 w-5" />
            </div>
            <p className="mt-5 text-lg font-semibold tracking-tight text-stone-950">
              Snemanje
            </p>
          </button>

          <button
            type="button"
            onClick={() => setCaptureMode("upload")}
            className={`rounded-[24px] border px-5 py-5 text-left transition ${
              captureMode === "upload"
                ? "border-blue-200 bg-[var(--brand-soft)] shadow-[0_10px_24px_rgba(0,113,227,0.08)]"
                : "border-stone-200 bg-white hover:border-stone-300"
            }`}
            >
            <div
              className={`inline-flex rounded-[18px] p-3 ${
                captureMode === "upload"
                  ? "bg-white text-blue-700"
                  : "bg-stone-100 text-stone-500"
              }`}
            >
              <UploadCloud className="h-5 w-5" />
            </div>
            <p className="mt-5 text-lg font-semibold tracking-tight text-stone-950">
              Naloži
            </p>
          </button>
        </div>
      </section>

      <section className="surface-card-strong p-7 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="section-title">
                {captureMode === "record" ? "Posnemi predavanje" : "Naloži posnetek"}
              </h2>
            </div>
            <div className="rounded-full bg-[var(--brand-soft)] p-3 text-blue-700">
              <Waves className="h-5 w-5" />
            </div>
          </div>

          <label className="surface-muted mt-6 flex items-start gap-3 p-4 text-sm leading-6 text-stone-700">
            <input
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-stone-300 text-blue-700"
            />
            <span>
              Potrjujem, da imam dovoljenje za snemanje tega predavanja in za
              obdelavo posnetka v tej aplikaciji.
            </span>
          </label>

          <div className="mt-6">
            {captureMode === "record" ? (
              <button
                type="button"
                onClick={() => void (isRecording ? stopRecording() : startRecording())}
                className={cn(
                  "flex min-h-64 w-full flex-col justify-between rounded-[30px] border p-7 text-left transition",
                  isRecording
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-stone-200 bg-white hover:border-blue-300 hover:bg-[var(--brand-soft)]",
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${
                      isRecording
                        ? "border border-rose-200 bg-white text-rose-700"
                        : "border border-blue-200 bg-[var(--brand-soft)] text-blue-800"
                    }`}
                  >
                    {isRecording ? "Snemanje v teku" : "Pripravljeno"}
                  </span>
                  {isRecording ? (
                    <PauseCircle className="h-7 w-7" />
                  ) : (
                    <Mic className="h-7 w-7" />
                  )}
                </div>

                <div>
                  <p className="text-[2rem] font-semibold tracking-tight text-stone-950">
                    {isRecording ? "Ustavi snemanje" : "Začni snemanje"}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-stone-500">
                    {isRecording
                      ? `Čas snemanja: ${formatTimestamp(elapsedSeconds * 1000)}`
                      : "Mikrofon ostane vklopljen, dokler je stran odprta."}
                  </p>
                </div>

                <div
                  className={cn(
                    "px-4 py-4 transition",
                    isRecording
                      ? "text-[var(--label)]"
                      : "text-[var(--secondary-label)]",
                  )}
                >
                  <LiveAudioWave
                    stream={visualizerStream}
                    active={isRecording}
                    className="mx-auto max-w-[15rem]"
                  />
                </div>
              </button>
            ) : (
              <label className="flex min-h-64 cursor-pointer flex-col justify-between rounded-[30px] border border-stone-200 bg-white p-7 transition hover:border-blue-300 hover:bg-[var(--brand-soft)]">
                <div className="flex items-center justify-between gap-4">
                  <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-stone-700">
                    Datoteka
                  </span>
                  <UploadCloud className="h-7 w-7 text-blue-700" />
                </div>

                <div>
                  <p className="text-[2rem] font-semibold tracking-tight text-stone-950">
                    Izberi zvočno datoteko
                  </p>
                  <p className="mt-2 text-sm leading-7 text-stone-500">
                    MP3, M4A, WAV, OGG, WEBM.
                  </p>
                </div>

                <input
                  type="file"
                  accept={AUDIO_FILE_INPUT_ACCEPT}
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={!consent || isUploading}
                />
              </label>
            )}
          </div>

          {recordingSupported === false && (
            <p className="mt-4 text-sm leading-7 text-amber-800">
              Ta brskalnik ne podpira `MediaRecorder`. Nalaganje datotek še vedno deluje.
            </p>
          )}

          {error ? <div className="danger-panel mt-5 px-4 py-3 text-sm">{error}</div> : null}
          <div className="mt-6 flex justify-end">
            <div className="flex w-full flex-col gap-3 sm:w-auto">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!source || !consent || isUploading}
                className="primary-button w-full px-5 py-3.5 text-sm sm:w-auto sm:min-w-64"
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {stage === "creating" && "Ustvarjam zapisek"}
                {stage === "uploading" && "Nalagam zvok"}
                {stage === "finalizing" && "Začenjam obdelavo"}
                {stage === "idle" && "Ustvari zapiske"}
              </button>
              {isUploading ? (
                <button
                  type="button"
                  onClick={() => void handleCancelUpload()}
                  disabled={isCancelling}
                  className="ios-secondary-button w-full sm:min-w-64"
                >
                  {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Prekliči
                </button>
              ) : null}
            </div>
          </div>
      </section>
    </div>
  );
}
