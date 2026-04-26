"use client";

import { Loader2, Pause, Play } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import {
  DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID,
  DEFAULT_NOTE_TTS_PLAYBACK_RATE,
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_HIGHLIGHT_COLORS,
  NOTE_TTS_PLAYBACK_RATES,
  NOTE_TTS_VOICES,
  type NoteTtsHighlightColorId,
  type NoteTtsPlaybackRate,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
import {
  buildNoteTtsChunks,
  parseNoteTtsDocument,
  type NoteTtsBlock,
  type NoteTtsDocument,
  type NoteTtsInlineToken,
} from "@/lib/note-tts-text";

type TtsStatusResponse = {
  available: boolean;
  reason: string | null;
  tier: "paid" | "free";
  limitSeconds: number;
  secondsUsed: number;
  remainingSeconds: number;
  chunkCount: number;
  totalWords: number;
  error?: string;
};

type TtsChunkResponse = {
  audioUrl: string;
  chunkIndex: number;
  chunkCount: number;
  wordStartIndex: number;
  wordEndIndex: number;
  durationMs: number;
  alignment: Array<{
    wordIndex: number;
    startMs: number;
    endMs: number;
  }>;
  limitSeconds: number;
  secondsUsed: number;
  remainingSeconds: number;
  error?: string;
  code?: string;
};

type ActiveChunk = TtsChunkResponse;

const AUTO_SCROLL_IDLE_MS = 5_000;
const NOTE_TTS_VOICE_STORAGE_KEY = "memo-note-tts-voice";
const NOTE_TTS_RATE_STORAGE_KEY = "memo-note-tts-rate";
const NOTE_TTS_COLOR_STORAGE_KEY = "memo-note-tts-color";

function createReadSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStoredVoice(): NoteTtsVoice {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  const storedVoice = window.localStorage.getItem(NOTE_TTS_VOICE_STORAGE_KEY);

  return NOTE_TTS_VOICES.find((voice) => voice === storedVoice) ?? DEFAULT_NOTE_TTS_VOICE;
}

function getStoredPlaybackRate(): NoteTtsPlaybackRate {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_PLAYBACK_RATE;
  }

  const storedRate = Number(window.localStorage.getItem(NOTE_TTS_RATE_STORAGE_KEY));

  return (
    NOTE_TTS_PLAYBACK_RATES.find((rate) => rate === storedRate) ??
    DEFAULT_NOTE_TTS_PLAYBACK_RATE
  );
}

function getStoredHighlightColorId(): NoteTtsHighlightColorId {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID;
  }

  const storedColor = window.localStorage.getItem(NOTE_TTS_COLOR_STORAGE_KEY);

  return (
    NOTE_TTS_HIGHLIGHT_COLORS.find((color) => color.id === storedColor)?.id ??
    DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID
  );
}

function getChunkCacheKey(voice: NoteTtsVoice, chunkIndex: number) {
  return `${voice}:${chunkIndex}`;
}

function getPlaybackWordState(activeChunk: ActiveChunk, currentMs: number) {
  const firstTiming = activeChunk.alignment[0];

  if (!firstTiming) {
    return {
      completedWordIndex: activeChunk.wordStartIndex - 1,
      currentWordIndex: null,
    };
  }

  let completedWordIndex = activeChunk.wordStartIndex - 1;
  let currentWordIndex = firstTiming.wordIndex;

  for (const timing of activeChunk.alignment) {
    if (timing.startMs <= currentMs) {
      if (timing.wordIndex !== currentWordIndex) {
        completedWordIndex = currentWordIndex;
      }

      currentWordIndex = timing.wordIndex;
      continue;
    }

    break;
  }

  return {
    completedWordIndex,
    currentWordIndex,
  };
}

function getQuotaRemainingPercent(status: TtsStatusResponse | null) {
  if (!status) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((status.remainingSeconds / status.limitSeconds) * 100)),
  );
}

function QuotaUsageMenu({
  status,
  playbackRate,
  selectedVoice,
  highlightColorId,
  onPlaybackRateChange,
  onVoiceChange,
  onHighlightColorChange,
}: {
  status: TtsStatusResponse | null;
  playbackRate: NoteTtsPlaybackRate;
  selectedVoice: NoteTtsVoice;
  highlightColorId: NoteTtsHighlightColorId;
  onPlaybackRateChange: (rate: NoteTtsPlaybackRate) => void;
  onVoiceChange: (voice: NoteTtsVoice) => void;
  onHighlightColorChange: (colorId: NoteTtsHighlightColorId) => void;
}) {
  if (!status) {
    return null;
  }

  const remainingPercent = getQuotaRemainingPercent(status);
  const usedPercent = 100 - remainingPercent;
  const isLimitReached = status.remainingSeconds <= 0;
  const remainingLabel = `${remainingPercent}%`;

  return (
    <details className={`note-read-usage-menu ${isLimitReached ? "limit" : ""}`}>
      <summary
        className="note-read-usage-trigger"
        aria-label={
          isLimitReached
            ? "Limit poslušanja dosežen"
            : `Preostalo ${remainingPercent} % dnevnega poslušanja`
        }
        title="Poraba poslušanja"
      >
        <EmojiIcon
          className="library-folder-chevron note-read-usage-chevron"
          symbol="▾"
          size="0.95rem"
        />
      </summary>
      <div className="note-read-usage-popover">
        <div
          className="note-read-usage-bar"
          role="progressbar"
          aria-label={
            isLimitReached
              ? "Limit poslušanja dosežen"
              : `Preostalo ${remainingPercent} % dnevnega poslušanja, porabljeno ${usedPercent} %`
          }
          aria-valuetext={`${remainingPercent} % preostalo, ${usedPercent} % porabljeno`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={remainingPercent}
        >
          <span className="note-read-usage-fill" style={{ width: `${remainingPercent}%` }} />
          <span className="note-read-usage-bar-label">{remainingLabel}</span>
        </div>
        <div className="note-read-usage-reset">Ponastavi se ob 00:00</div>
        <div className="note-read-settings-divider" />
        <div className="note-read-setting-group">
          <span className="note-read-setting-label">Hitrost</span>
          <div className="note-read-rate-options" role="group" aria-label="Hitrost branja">
            {NOTE_TTS_PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`note-read-rate-option ${playbackRate === rate ? "active" : ""}`}
                onClick={() => onPlaybackRateChange(rate)}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
        <label className="note-read-setting-group">
          <span className="note-read-setting-label">Glas</span>
          <span className="note-read-setting-select-wrap">
            <select
              className="note-read-setting-select"
              value={selectedVoice}
              onChange={(event) => {
                const nextVoice = NOTE_TTS_VOICES.find((voice) => voice === event.target.value);

                if (nextVoice) {
                  onVoiceChange(nextVoice);
                }
              }}
            >
              {NOTE_TTS_VOICES.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className="note-read-setting-group">
          <span className="note-read-setting-label">Barva</span>
          <div className="note-read-color-options" role="group" aria-label="Barva označevanja">
            {NOTE_TTS_HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`note-read-color-option ${
                  highlightColorId === color.id ? "active" : ""
                }`}
                onClick={() => onHighlightColorChange(color.id)}
                aria-label={color.label}
                title={color.label}
                style={{ "--note-read-swatch-color": color.currentBackground } as CSSProperties}
              />
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    const message = payload.error || "Poslušanja ni bilo mogoče pripraviti.";

    if (response.status === 429 || message.includes("HTTP 429")) {
      throw new Error("Poslušanje se še pripravlja. Poskusi znova čez trenutek.");
    }

    throw new Error(message);
  }

  return payload;
}

function WordToken({
  token,
  completedWordIndex,
  currentWordIndex,
  spokenStartWordIndex,
}: {
  token: Extract<NoteTtsInlineToken, { type: "word" }>;
  completedWordIndex: number;
  currentWordIndex: number | null;
  spokenStartWordIndex: number;
}) {
  const stateClass =
    token.wordIndex === currentWordIndex
      ? "current"
      : token.wordIndex >= spokenStartWordIndex && token.wordIndex <= completedWordIndex
        ? "read"
        : "";

  return (
    <span className={`note-read-word ${stateClass}`} data-word-index={token.wordIndex}>
      {token.text}
    </span>
  );
}

function renderTokens(params: {
  tokens: NoteTtsInlineToken[];
  completedWordIndex: number;
  currentWordIndex: number | null;
  spokenStartWordIndex: number;
}) {
  return params.tokens.map((token, index) => {
    if (token.type === "text") {
      return <span key={`text-${index}`}>{token.text}</span>;
    }

    return (
      <WordToken
        key={`word-${token.wordIndex}`}
        token={token}
        completedWordIndex={params.completedWordIndex}
        currentWordIndex={params.currentWordIndex}
        spokenStartWordIndex={params.spokenStartWordIndex}
      />
    );
  });
}

function ReadAlongBlock({
  block,
  completedWordIndex,
  currentWordIndex,
  spokenStartWordIndex,
}: {
  block: NoteTtsBlock;
  completedWordIndex: number;
  currentWordIndex: number | null;
  spokenStartWordIndex: number;
}) {
  const children = renderTokens({
    tokens: block.tokens,
    completedWordIndex,
    currentWordIndex,
    spokenStartWordIndex,
  });

  if (block.kind === "heading") {
    return block.level && block.level <= 2 ? <h2>{children}</h2> : <h3>{children}</h3>;
  }

  if (block.kind === "list_item") {
    return (
      <ul>
        <li>{children}</li>
      </ul>
    );
  }

  return <p>{children}</p>;
}

function ReadAlongMarkdown({
  document,
  completedWordIndex,
  currentWordIndex,
  spokenStartWordIndex,
}: {
  document: NoteTtsDocument;
  completedWordIndex: number;
  currentWordIndex: number | null;
  spokenStartWordIndex: number;
}) {
  return (
    <div className="markdown text-sm text-stone-700 sm:text-[15px]">
      {document.blocks.map((block) => (
        <ReadAlongBlock
          key={block.id}
          block={block}
          completedWordIndex={completedWordIndex}
          currentWordIndex={currentWordIndex}
          spokenStartWordIndex={spokenStartWordIndex}
        />
      ))}
    </div>
  );
}

export function NoteReadAloud({
  lectureId,
  content,
}: {
  lectureId: string;
  content: string;
}) {
  const document = useMemo(() => parseNoteTtsDocument(content), [content]);
  const chunks = useMemo(() => buildNoteTtsChunks(document), [document]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastAutoScrolledWordRef = useRef<number | null>(null);
  const lastUserInteractionRef = useRef(Date.now());
  const ignoreScrollUntilRef = useRef(0);
  const prefetchedChunksRef = useRef(new Map<string, TtsChunkResponse>());
  const pendingChunkRequestsRef = useRef(new Map<string, Promise<TtsChunkResponse | null>>());
  const prefetchQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playbackWordStateRef = useRef<{
    completedWordIndex: number;
    currentWordIndex: number | null;
  }>({
    completedWordIndex: -1,
    currentWordIndex: null,
  });
  const sessionIdRef = useRef<string>(createReadSessionId());
  const [status, setStatus] = useState<TtsStatusResponse | null>(null);
  const [activeChunk, setActiveChunk] = useState<ActiveChunk | null>(null);
  const [activeChunkIndex, setActiveChunkIndex] = useState(0);
  const [completedWordIndex, setCompletedWordIndex] = useState(-1);
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);
  const [spokenStartWordIndex, setSpokenStartWordIndex] = useState(0);
  const [playbackRate, setPlaybackRate] =
    useState<NoteTtsPlaybackRate>(getStoredPlaybackRate);
  const [selectedVoice, setSelectedVoice] = useState<NoteTtsVoice>(getStoredVoice);
  const [highlightColorId, setHighlightColorId] =
    useState<NoteTtsHighlightColorId>(getStoredHighlightColorId);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isFetchingChunk, setIsFetchingChunk] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightColor =
    NOTE_TTS_HIGHLIGHT_COLORS.find((color) => color.id === highlightColorId) ??
    NOTE_TTS_HIGHLIGHT_COLORS[0];
  const readAlongStyle = {
    "--note-read-read-bg": highlightColor.readBackground,
    "--note-read-read-color": highlightColor.readColor,
    "--note-read-current-bg": highlightColor.currentBackground,
    "--note-read-current-color": highlightColor.currentColor,
    "--note-read-current-ring": highlightColor.currentRing,
  } as CSSProperties;

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setIsLoadingStatus(true);

      try {
        const response = await fetch(`/api/lectures/${lectureId}/tts/status`, {
          cache: "no-store",
        });
        const payload = await parseResponse<TtsStatusResponse>(response);

        if (!cancelled) {
          setStatus(payload);
          setError(null);
        }
      } catch (statusError) {
        if (!cancelled) {
          setError(statusError instanceof Error ? statusError.message : "Poslušanje ni na voljo.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [lectureId]);

  useEffect(() => {
    window.localStorage.setItem(NOTE_TTS_RATE_STORAGE_KEY, String(playbackRate));

    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    window.localStorage.setItem(NOTE_TTS_COLOR_STORAGE_KEY, highlightColorId);
  }, [highlightColorId]);

  const updateQuota = useCallback((payload: TtsChunkResponse) => {
    setStatus((current) =>
      current
        ? {
            ...current,
            limitSeconds: payload.limitSeconds,
            secondsUsed: payload.secondsUsed,
            remainingSeconds: payload.remainingSeconds,
          }
        : current,
    );
  }, []);

  const setPlaybackWordState = useCallback(
    (wordState: { completedWordIndex: number; currentWordIndex: number | null }) => {
      playbackWordStateRef.current = wordState;
      setCompletedWordIndex(wordState.completedWordIndex);
      setCurrentWordIndex(wordState.currentWordIndex);
    },
    [],
  );

  useEffect(() => {
    window.localStorage.setItem(NOTE_TTS_VOICE_STORAGE_KEY, selectedVoice);
    sessionIdRef.current = createReadSessionId();
    prefetchedChunksRef.current.clear();
    pendingChunkRequestsRef.current.clear();
    prefetchQueueRef.current = Promise.resolve();

    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    setActiveChunk(null);
    setActiveChunkIndex(0);
    setSpokenStartWordIndex(0);
    setIsPlaying(false);
    setPlaybackWordState({
      completedWordIndex: -1,
      currentWordIndex: null,
    });
  }, [selectedVoice, setPlaybackWordState]);

  const fetchChunk = useCallback(
    async (chunkIndex: number, options?: { silent?: boolean }) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);
      const cachedChunk = prefetchedChunksRef.current.get(cacheKey);

      if (cachedChunk) {
        return cachedChunk;
      }

      const pendingRequest = pendingChunkRequestsRef.current.get(cacheKey);

      if (pendingRequest) {
        return pendingRequest;
      }

      const request = (async () => {
        try {
          const response = await fetch(`/api/lectures/${lectureId}/tts/chunks`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              chunkIndex,
              voice: selectedVoice,
            }),
          });
          const payload = await parseResponse<TtsChunkResponse>(response);
          updateQuota(payload);
          prefetchedChunksRef.current.set(cacheKey, payload);

          return payload;
        } catch (chunkError) {
          const message =
            chunkError instanceof Error ? chunkError.message : "Poslušanje ni na voljo.";

          if (!options?.silent) {
            setError(message);
          }

          if (message === "Limit dosežen.") {
            setStatus((current) =>
              current
                ? {
                    ...current,
                    remainingSeconds: 0,
                  }
                : current,
            );
          }

          return null;
        } finally {
          pendingChunkRequestsRef.current.delete(cacheKey);
        }
      })();

      pendingChunkRequestsRef.current.set(cacheKey, request);

      return request;
    },
    [lectureId, selectedVoice, updateQuota],
  );

  const loadChunk = useCallback(
    async (chunkIndex: number) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);
      const hasReadyChunk = prefetchedChunksRef.current.has(cacheKey);

      if (!hasReadyChunk) {
        setIsFetchingChunk(true);
      }

      setError(null);

      try {
        const payload = await fetchChunk(chunkIndex);

        if (payload) {
          setActiveChunk(payload);
          setActiveChunkIndex(payload.chunkIndex);
        }

        return payload;
      } finally {
        setIsFetchingChunk(false);
      }
    },
    [fetchChunk, selectedVoice],
  );

  const prefetchChunk = useCallback(
    (chunkIndex: number) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);

      if (
        prefetchedChunksRef.current.has(cacheKey) ||
        pendingChunkRequestsRef.current.has(cacheKey)
      ) {
        return;
      }

      prefetchQueueRef.current = prefetchQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            prefetchedChunksRef.current.has(cacheKey) ||
            pendingChunkRequestsRef.current.has(cacheKey)
          ) {
            return;
          }

          await fetchChunk(chunkIndex, { silent: true });
        });
    },
    [fetchChunk, selectedVoice],
  );

  const prefetchUpcomingChunks = useCallback(
    (chunkIndex: number) => {
      if (!status?.available || status.remainingSeconds <= 0) {
        return;
      }

      const bufferSize = playbackRate >= 1.5 ? 2 : 1;

      for (let offset = 1; offset <= bufferSize; offset += 1) {
        const nextChunkIndex = chunkIndex + offset;

        if (nextChunkIndex >= chunks.length) {
          break;
        }

        prefetchChunk(nextChunkIndex);
      }
    },
    [chunks.length, playbackRate, prefetchChunk, status?.available, status?.remainingSeconds],
  );

  useEffect(() => {
    if (!status?.available || status.remainingSeconds <= 0 || chunks.length === 0) {
      return;
    }

    prefetchChunk(0);
  }, [chunks.length, prefetchChunk, status?.available, status?.remainingSeconds]);

  useEffect(() => {
    const markUserInteraction = () => {
      lastUserInteractionRef.current = Date.now();
    };
    const markUserScroll = () => {
      if (Date.now() < ignoreScrollUntilRef.current) {
        return;
      }

      markUserInteraction();
    };

    window.addEventListener("scroll", markUserScroll, { passive: true });
    window.addEventListener("wheel", markUserInteraction, { passive: true });
    window.addEventListener("touchstart", markUserInteraction, { passive: true });
    window.addEventListener("pointerdown", markUserInteraction, { passive: true });
    window.addEventListener("keydown", markUserInteraction);

    return () => {
      window.removeEventListener("scroll", markUserScroll);
      window.removeEventListener("wheel", markUserInteraction);
      window.removeEventListener("touchstart", markUserInteraction);
      window.removeEventListener("pointerdown", markUserInteraction);
      window.removeEventListener("keydown", markUserInteraction);
    };
  }, []);

  const updatePlaybackPosition = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeChunk) {
      return;
    }

    const wordState = getPlaybackWordState(
      activeChunk,
      Math.max(0, audio.currentTime * 1000),
    );
    const previous = playbackWordStateRef.current;

    if (
      previous.completedWordIndex === wordState.completedWordIndex &&
      previous.currentWordIndex === wordState.currentWordIndex
    ) {
      return;
    }

    setPlaybackWordState(wordState);
  }, [activeChunk, setPlaybackWordState]);

  const resetPlaybackWordState = useCallback(
    (completedWordIndex: number) => {
      setPlaybackWordState({
        completedWordIndex,
        currentWordIndex: null,
      });
    },
    [setPlaybackWordState],
  );

  const playChunk = useCallback(
    async (chunkIndex: number) => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      const payload = await loadChunk(chunkIndex);

      if (!payload) {
        setIsPlaying(false);
        return;
      }

      audio.src = payload.audioUrl;
      audio.currentTime = 0;
      audio.playbackRate = playbackRate;
      setSpokenStartWordIndex(payload.wordStartIndex);
      setPlaybackWordState({
        completedWordIndex: payload.wordStartIndex - 1,
        currentWordIndex: payload.alignment[0]?.wordIndex ?? payload.wordStartIndex,
      });
      lastAutoScrolledWordRef.current = null;

      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setError("Za začetek poslušanja pritisni še enkrat.");
        setIsPlaying(false);
      }
    },
    [loadChunk, playbackRate, setPlaybackWordState],
  );

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;

    if (!audio || isFetchingChunk || isLoadingStatus || !status?.available || status.remainingSeconds <= 0) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (activeChunk && audio.src && audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setError("Za začetek poslušanja pritisni še enkrat.");
      }
      return;
    }

    await playChunk(activeChunkIndex);
  }, [
    activeChunk,
    activeChunkIndex,
    isFetchingChunk,
    isLoadingStatus,
    isPlaying,
    playChunk,
    status,
  ]);

  useEffect(() => {
    if (!isPlaying || !activeChunk) {
      return;
    }

    let animationFrame = 0;
    let lastTickMs = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastTickMs >= 90) {
        updatePlaybackPosition();
        lastTickMs = timestamp;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeChunk, isPlaying, updatePlaybackPosition]);

  useEffect(() => {
    if (!isPlaying || !activeChunk) {
      return;
    }

    prefetchUpcomingChunks(activeChunk.chunkIndex);
  }, [activeChunk, isPlaying, prefetchUpcomingChunks]);

  useEffect(() => {
    if (currentWordIndex === null || !isPlaying) {
      return;
    }

    if (lastAutoScrolledWordRef.current === currentWordIndex) {
      return;
    }

    if (Date.now() - lastUserInteractionRef.current < AUTO_SCROLL_IDLE_MS) {
      return;
    }

    const wordElement = contentRef.current?.querySelector<HTMLElement>(
      `[data-word-index="${currentWordIndex}"]`,
    );

    if (!wordElement) {
      return;
    }

    lastAutoScrolledWordRef.current = currentWordIndex;

    const rect = wordElement.getBoundingClientRect();
    const topLimit = window.innerHeight * 0.22;
    const bottomLimit = window.innerHeight * 0.72;

    if (rect.top < topLimit || rect.bottom > bottomLimit) {
      ignoreScrollUntilRef.current = Date.now() + 900;
      wordElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  }, [currentWordIndex, isPlaying]);

  const handleEnded = useCallback(() => {
    if (!activeChunk) {
      setIsPlaying(false);
      return;
    }

    resetPlaybackWordState(activeChunk.wordEndIndex - 1);

    const nextChunkIndex = activeChunk.chunkIndex + 1;

    if (nextChunkIndex < activeChunk.chunkCount && (status?.remainingSeconds ?? 0) > 0) {
      void playChunk(nextChunkIndex);
      return;
    }

    setActiveChunk(null);
    setActiveChunkIndex(0);
    setSpokenStartWordIndex(0);
    resetPlaybackWordState(document.words.length - 1);
    setIsPlaying(false);
  }, [
    activeChunk,
    document.words.length,
    playChunk,
    resetPlaybackWordState,
    status?.remainingSeconds,
  ]);

  const disabled =
    isLoadingStatus ||
    isFetchingChunk ||
    !status?.available ||
    status.remainingSeconds <= 0 ||
    chunks.length === 0;
  const playButtonLabel =
    isFetchingChunk || isLoadingStatus
      ? "Pripravljam..."
      : isPlaying
        ? "Premor"
        : activeChunk
          ? "Nadaljuj"
          : "Poslušaj";

  return (
    <>
      <div className="note-read-toolbar">
        <button
          type="button"
          className="note-read-button"
          onClick={() => {
            void handlePlayPause();
          }}
          disabled={disabled}
          aria-label={playButtonLabel}
        >
          {isFetchingChunk || isLoadingStatus ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span>{playButtonLabel}</span>
        </button>
        <QuotaUsageMenu
          status={status}
          playbackRate={playbackRate}
          selectedVoice={selectedVoice}
          highlightColorId={highlightColorId}
          onPlaybackRateChange={setPlaybackRate}
          onVoiceChange={setSelectedVoice}
          onHighlightColorChange={setHighlightColorId}
        />
        {error ? <span className="note-read-error">{error}</span> : null}
      </div>
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={updatePlaybackPosition}
        onEnded={handleEnded}
        onPause={() => setIsPlaying(false)}
        className="note-read-audio"
      />
      <div ref={contentRef} style={readAlongStyle}>
        <ReadAlongMarkdown
          document={document}
          completedWordIndex={completedWordIndex}
          currentWordIndex={currentWordIndex}
          spokenStartWordIndex={spokenStartWordIndex}
        />
      </div>
    </>
  );
}
