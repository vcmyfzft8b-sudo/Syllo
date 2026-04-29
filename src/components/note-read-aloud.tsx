"use client";

import { Loader2, Pause, Play } from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import { ViewportPortal } from "@/components/viewport-portal";
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
  hasUnlimitedUsage?: boolean;
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
  hasUnlimitedUsage?: boolean;
  error?: string;
  code?: string;
};

type ActiveChunk = TtsChunkResponse;

const AUTO_SCROLL_IDLE_MS = 5_000;
const NOTE_TTS_VOICE_STORAGE_KEY = "memo-note-tts-voice";
const NOTE_TTS_RATE_STORAGE_KEY = "memo-note-tts-rate";
const NOTE_TTS_COLOR_STORAGE_KEY = "memo-note-tts-color";
const TTS_DAILY_LIMIT_MESSAGE = "Porabil si današnje poslušanje.";
const TTS_FREE_DAILY_LIMIT_MESSAGE =
  "Porabil si današnje brezplačno poslušanje. Nadgradi za več poslušanja.";
const TTS_PAID_DAILY_LIMIT_MESSAGE =
  "Porabil si današnje poslušanje. Znova lahko poslušaš po ponastavitvi ob 00:00.";
const READ_SETTINGS_SHEET_CLOSE_MS = 180;

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

function getDailyLimitDisplayMessage(status: TtsStatusResponse | null) {
  return status?.tier === "free" ? TTS_FREE_DAILY_LIMIT_MESSAGE : TTS_PAID_DAILY_LIMIT_MESSAGE;
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

  if (status.hasUnlimitedUsage) {
    return 100;
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
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const suppressClickRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const closeMenu = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    dragStartYRef.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
    setIsMenuOpen(false);
    setIsMenuClosing(false);
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }, []);

  const animateCloseMenu = useCallback(() => {
    if (isMenuClosing) {
      return;
    }

    dragStartYRef.current = null;
    dragOffsetRef.current = window.innerHeight;
    setIsMenuClosing(true);
    setDragOffset(window.innerHeight);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closeMenu();
    }, READ_SETTINGS_SHEET_CLOSE_MS);
  }, [closeMenu, isMenuClosing]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  function handleSheetPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, input, textarea, select, a, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".note-read-usage-drag-handle") : null;

    if (
      interactiveTarget &&
      !dragHandleTarget
    ) {
      return;
    }

    suppressClickRef.current = false;
    dragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateDragOffset(clientY: number) {
    if (dragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - dragStartYRef.current);
    dragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      suppressClickRef.current = true;
    }
    setDragOffset(nextOffset);
  }

  function handleSheetClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (dragOffsetRef.current > 80) {
        animateCloseMenu();
        return;
      }

      dragStartYRef.current = null;
      dragOffsetRef.current = 0;
      setDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [animateCloseMenu, isMenuOpen]);

  if (!status) {
    return null;
  }

  const remainingPercent = getQuotaRemainingPercent(status);
  const usedPercent = 100 - remainingPercent;
  const isLimitReached = !status.hasUnlimitedUsage && status.remainingSeconds <= 0;
  const remainingLabel = status.hasUnlimitedUsage ? "∞" : `${remainingPercent}%`;

  const menuContent = (
    <>
      <button
        type="button"
        className="mobile-sheet-drag-handle note-read-usage-drag-handle"
        aria-label="Povleci navzdol za zapiranje"
      />
      <div
        className="note-read-usage-bar"
        role="progressbar"
        aria-label={
          isLimitReached
            ? "Limit poslušanja dosežen"
            : status.hasUnlimitedUsage
              ? "Brez dnevne omejitve poslušanja"
              : `Preostalo ${remainingPercent} % dnevnega poslušanja, porabljeno ${usedPercent} %`
        }
        aria-valuetext={
          status.hasUnlimitedUsage
            ? "Brez dnevne omejitve poslušanja"
            : `${remainingPercent} % preostalo, ${usedPercent} % porabljeno`
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remainingPercent}
      >
        <span className="note-read-usage-fill" style={{ width: `${remainingPercent}%` }} />
        <span className="note-read-usage-bar-label">{remainingLabel}</span>
      </div>
      <div className="note-read-usage-reset">
        {status.hasUnlimitedUsage ? "Brez dnevne omejitve" : "Ponastavi se ob 00:00"}
      </div>
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
    </>
  );

  return (
    <>
      <details
        ref={menuRef}
        className={`note-read-usage-menu ${isLimitReached ? "limit" : ""}`}
        onToggle={(event) => {
          const isOpen = event.currentTarget.open;
          setIsMenuOpen(isOpen);
          if (isOpen) {
            setIsMenuClosing(false);
            dragStartYRef.current = null;
            dragOffsetRef.current = 0;
            setDragOffset(0);
          }
        }}
      >
        <summary
          className="note-read-usage-trigger"
          aria-label={
            isLimitReached
              ? "Limit poslušanja dosežen"
              : status.hasUnlimitedUsage
                ? "Brez dnevne omejitve poslušanja"
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
        <div className="note-read-usage-popover note-read-usage-inline-popover">
          {menuContent}
        </div>
      </details>
      {isMenuOpen ? (
        <ViewportPortal>
          <button
            type="button"
            className="note-read-usage-mobile-backdrop"
            onClick={animateCloseMenu}
            aria-label="Zapri nastavitve poslušanja"
          />
          <div
            className="note-read-usage-popover note-read-usage-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Nastavitve poslušanja"
            onPointerDown={handleSheetPointerDown}
            onClickCapture={handleSheetClickCapture}
            style={
              dragOffset > 0
                ? { transform: `translateY(${dragOffset}px)` }
                : undefined
            }
          >
            {menuContent}
          </div>
        </ViewportPortal>
      ) : null}
    </>
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    code?: string;
    error?: string;
  };

  if (!response.ok) {
    const message = payload.error || "Poslušanja ni bilo mogoče pripraviti.";

    if (payload.code === "tts_daily_limit_reached") {
      throw new Error(TTS_DAILY_LIMIT_MESSAGE);
    }

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
}: {
  token: Extract<NoteTtsInlineToken, { type: "word" }>;
  completedWordIndex: number;
  currentWordIndex: number | null;
}) {
  const stateClass =
    token.wordIndex === currentWordIndex
      ? "current"
      : token.wordIndex <= completedWordIndex
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
      />
    );
  });
}

function ReadAlongBlock({
  block,
  completedWordIndex,
  currentWordIndex,
}: {
  block: NoteTtsBlock;
  completedWordIndex: number;
  currentWordIndex: number | null;
}) {
  const children = renderTokens({
    tokens: block.tokens,
    completedWordIndex,
    currentWordIndex,
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
}: {
  document: NoteTtsDocument;
  completedWordIndex: number;
  currentWordIndex: number | null;
}) {
  return (
    <div className="markdown text-sm text-stone-700 sm:text-[15px]">
      {document.blocks.map((block) => (
        <ReadAlongBlock
          key={block.id}
          block={block}
          completedWordIndex={completedWordIndex}
          currentWordIndex={currentWordIndex}
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
  const [playbackRate, setPlaybackRate] = useState<NoteTtsPlaybackRate>(
    DEFAULT_NOTE_TTS_PLAYBACK_RATE,
  );
  const [selectedVoice, setSelectedVoice] =
    useState<NoteTtsVoice>(DEFAULT_NOTE_TTS_VOICE);
  const [highlightColorId, setHighlightColorId] =
    useState<NoteTtsHighlightColorId>(DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID);
  const [hasHydratedSettings, setHasHydratedSettings] = useState(false);
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
    setPlaybackRate(getStoredPlaybackRate());
    setSelectedVoice(getStoredVoice());
    setHighlightColorId(getStoredHighlightColorId());
    setHasHydratedSettings(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_RATE_STORAGE_KEY, String(playbackRate));

    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [hasHydratedSettings, playbackRate]);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_COLOR_STORAGE_KEY, highlightColorId);
  }, [hasHydratedSettings, highlightColorId]);

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

  const resetPlaybackToStart = useCallback(() => {
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

    lastAutoScrolledWordRef.current = null;
    setActiveChunk(null);
    setActiveChunkIndex(0);
    setIsPlaying(false);
    setPlaybackWordState({
      completedWordIndex: -1,
      currentWordIndex: null,
    });
  }, [setPlaybackWordState]);

  useEffect(() => {
    if (status && !status.hasUnlimitedUsage && status.remainingSeconds <= 0) {
      setError(getDailyLimitDisplayMessage(status));
    }
  }, [status]);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_VOICE_STORAGE_KEY, selectedVoice);
    resetPlaybackToStart();
  }, [hasHydratedSettings, resetPlaybackToStart, selectedVoice]);

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
          const isDailyLimit =
            message === "Limit dosežen." || message === TTS_DAILY_LIMIT_MESSAGE;
          const displayMessage = isDailyLimit
            ? getDailyLimitDisplayMessage(status)
            : message;

          setError(displayMessage);

          if (isDailyLimit) {
            setStatus((current) =>
              current
                ? {
                    ...current,
                    remainingSeconds: 0,
                  }
                : current,
            );

            if (!options?.silent) {
              resetPlaybackToStart();
            }
          }

          return null;
        } finally {
          pendingChunkRequestsRef.current.delete(cacheKey);
        }
      })();

      pendingChunkRequestsRef.current.set(cacheKey, request);

      return request;
    },
    [lectureId, resetPlaybackToStart, selectedVoice, status, updateQuota],
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
    if (
      !hasHydratedSettings ||
      !status?.available ||
      status.remainingSeconds <= 0 ||
      chunks.length === 0
    ) {
      return;
    }

    prefetchChunk(0);
  }, [
    chunks.length,
    hasHydratedSettings,
    prefetchChunk,
    status?.available,
    status?.remainingSeconds,
  ]);

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

    if (nextChunkIndex < activeChunk.chunkCount) {
      if ((status?.remainingSeconds ?? 0) > 0) {
        void playChunk(nextChunkIndex);
        return;
      }

      setError(getDailyLimitDisplayMessage(status));
      setStatus((current) =>
        current
          ? {
              ...current,
              remainingSeconds: 0,
            }
          : current,
      );
      resetPlaybackToStart();
      return;
    }

    setActiveChunk(null);
    setActiveChunkIndex(0);
    resetPlaybackWordState(document.words.length - 1);
    setIsPlaying(false);
  }, [
    activeChunk,
    document.words.length,
    playChunk,
    resetPlaybackWordState,
    resetPlaybackToStart,
    status,
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
        />
      </div>
    </>
  );
}
