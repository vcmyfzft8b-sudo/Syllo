import "server-only";

import { createHash } from "node:crypto";

import { SonioxNodeClient, type TranscriptToken } from "@soniox/node";

import { STORAGE_BUCKET } from "@/lib/constants";
import type { Json, LectureTtsChunkRow } from "@/lib/database.types";
import { normalizeNoteLanguage } from "@/lib/languages";
import { DEFAULT_NOTE_TTS_VOICE, type NoteTtsVoice } from "@/lib/note-tts-settings";
import type { NoteTtsChunkPlan, NoteTtsWord } from "@/lib/note-tts-text";
import { getServerEnv, requireSonioxEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type TtsAlignmentWord = {
  wordIndex: number;
  startMs: number;
  endMs: number;
};

export type TtsQuotaState = {
  allowed: boolean;
  alreadyConsumed: boolean;
  secondsUsed: number;
  remainingSeconds: number;
  limitSeconds: number;
  chargedSeconds: number;
  code?: string;
};

export const FREE_TTS_DAILY_LIMIT_SECONDS = 5 * 60;
export const PAID_TTS_DAILY_LIMIT_SECONDS = 60 * 60;
export const UNLIMITED_TTS_USAGE_SECONDS = Number.MAX_SAFE_INTEGER;

const UNLIMITED_TTS_USAGE_EMAILS = new Set(["nace.valencic@gmail.com"]);

const TTS_OUTPUT_FORMAT = "mp3";
const TTS_OUTPUT_MIME_TYPE = "audio/mpeg";
const TTS_OUTPUT_BITRATE = 64_000;
const TTS_WAIT_TIMEOUT_MS = 120_000;
const TTS_WAIT_INTERVAL_MS = 2_000;

let sonioxClient: SonioxNodeClient | undefined;

function getSonioxClient() {
  if (!sonioxClient) {
    const env = requireSonioxEnv();
    sonioxClient = new SonioxNodeClient({
      api_key: env.SONIOX_API_KEY,
    });
  }

  return sonioxClient;
}

export function getTtsDailyLimitSeconds(hasPaidAccess: boolean) {
  return hasPaidAccess ? PAID_TTS_DAILY_LIMIT_SECONDS : FREE_TTS_DAILY_LIMIT_SECONDS;
}

export function hasUnlimitedTtsUsage(email?: string | null) {
  return email ? UNLIMITED_TTS_USAGE_EMAILS.has(email.trim().toLowerCase()) : false;
}

export function getLjubljanaUsageDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function hashNoteTtsContent(content: string) {
  return createHash("sha256").update(`note-tts-v4-skip-page-title:${content}`).digest("hex");
}

function safeStorageSegment(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "default";
}

function buildTtsStoragePath(params: {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunkIndex: number;
  model: string;
  voice: string;
}) {
  return [
    "tts",
    params.userId,
    params.lectureId,
    params.contentHash,
    `${String(params.chunkIndex).padStart(4, "0")}-${safeStorageSegment(params.model)}-${safeStorageSegment(params.voice)}.mp3`,
  ].join("/");
}

function normalizeAlignmentText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function collectTranscriptPieces(tokens: TranscriptToken[]) {
  return tokens
    .map((token, index) => ({
      index,
      text: normalizeAlignmentText(token.text),
      startMs: token.start_ms,
      endMs: token.end_ms,
    }))
    .filter((token) => token.text.length > 0 && !tokens[token.index]?.is_audio_event);
}

function interpolateMissingTimings(params: {
  timings: Array<TtsAlignmentWord | null>;
  wordStartIndex: number;
  durationMs: number;
}) {
  const timings = [...params.timings];
  const durationMs = Math.max(params.durationMs, timings.length * 250, 1);

  for (let index = 0; index < timings.length; index += 1) {
    if (timings[index]) {
      continue;
    }

    const previousIndex = (() => {
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        if (timings[candidate]) {
          return candidate;
        }
      }

      return -1;
    })();
    const nextIndex = (() => {
      for (let candidate = index + 1; candidate < timings.length; candidate += 1) {
        if (timings[candidate]) {
          return candidate;
        }
      }

      return timings.length;
    })();
    const previousEnd = previousIndex >= 0 ? timings[previousIndex]?.endMs ?? 0 : 0;
    const nextStart =
      nextIndex < timings.length ? timings[nextIndex]?.startMs ?? durationMs : durationMs;
    const missingCount = nextIndex - previousIndex - 1;
    const sliceMs = Math.max(80, (nextStart - previousEnd) / Math.max(missingCount, 1));
    const offset = index - previousIndex - 1;
    const startMs = Math.max(0, Math.round(previousEnd + sliceMs * offset));
    const endMs = Math.min(durationMs, Math.max(startMs + 80, Math.round(startMs + sliceMs)));

    timings[index] = {
      wordIndex: params.wordStartIndex + index,
      startMs,
      endMs,
    };
  }

  return timings.filter((timing): timing is TtsAlignmentWord => Boolean(timing));
}

export function alignTtsTokensToWords(params: {
  words: NoteTtsWord[];
  tokens: TranscriptToken[];
  wordStartIndex: number;
  durationMs: number;
}) {
  const transcriptPieces = collectTranscriptPieces(params.tokens);
  const timings: Array<TtsAlignmentWord | null> = Array.from({ length: params.words.length }, () => null);
  let tokenIndex = 0;

  for (const [wordOffset, word] of params.words.entries()) {
    const target = normalizeAlignmentText(word.text);

    if (!target) {
      continue;
    }

    let bestMatch:
      | {
          startPieceIndex: number;
          endPieceIndex: number;
        }
      | null = null;

    for (
      let candidateStart = tokenIndex;
      candidateStart < Math.min(transcriptPieces.length, tokenIndex + 8);
      candidateStart += 1
    ) {
      let accumulated = "";

      for (
        let candidateEnd = candidateStart;
        candidateEnd < Math.min(transcriptPieces.length, candidateStart + 8);
        candidateEnd += 1
      ) {
        accumulated += transcriptPieces[candidateEnd].text;

        if (accumulated === target || accumulated.includes(target) || target.includes(accumulated)) {
          bestMatch = {
            startPieceIndex: candidateStart,
            endPieceIndex: candidateEnd,
          };

          if (accumulated === target) {
            break;
          }
        }

        if (accumulated.length > target.length + 8) {
          break;
        }
      }

      if (bestMatch) {
        break;
      }
    }

    if (!bestMatch) {
      continue;
    }

    const startPiece = transcriptPieces[bestMatch.startPieceIndex];
    const endPiece = transcriptPieces[bestMatch.endPieceIndex];
    timings[wordOffset] = {
      wordIndex: word.index,
      startMs: Math.max(0, Math.round(startPiece.startMs)),
      endMs: Math.max(startPiece.startMs + 80, Math.round(endPiece.endMs)),
    };
    tokenIndex = bestMatch.endPieceIndex + 1;
  }

  return interpolateMissingTimings({
    timings,
    wordStartIndex: params.wordStartIndex,
    durationMs: params.durationMs,
  });
}

export async function getTtsUsageState(params: {
  userId: string;
  hasPaidAccess: boolean;
  hasUnlimitedUsage?: boolean;
}) {
  if (params.hasUnlimitedUsage) {
    return {
      usageDate: getLjubljanaUsageDate(),
      secondsUsed: 0,
      limitSeconds: UNLIMITED_TTS_USAGE_SECONDS,
      remainingSeconds: UNLIMITED_TTS_USAGE_SECONDS,
      hasUnlimitedUsage: true,
    };
  }

  const limitSeconds = getTtsDailyLimitSeconds(params.hasPaidAccess);
  const usageDate = getLjubljanaUsageDate();
  const { data } = await createSupabaseServiceRoleClient()
    .from("tts_daily_usage")
    .select("seconds_used, limit_seconds")
    .eq("user_id", params.userId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  const usage = data as { seconds_used: number; limit_seconds: number } | null;
  const secondsUsed = usage?.seconds_used ?? 0;

  return {
    usageDate,
    secondsUsed,
    limitSeconds,
    remainingSeconds: Math.max(limitSeconds - secondsUsed, 0),
    hasUnlimitedUsage: false,
  };
}

function isUniqueConstraintError(error: { code?: string } | null) {
  return error?.code === "23505";
}

async function readTtsUsageRow(params: { userId: string; usageDate: string }) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("tts_daily_usage")
    .select("seconds_used, limit_seconds")
    .eq("user_id", params.userId)
    .eq("usage_date", params.usageDate)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as { seconds_used: number; limit_seconds: number } | null;
}

async function ensureTtsUsageRow(params: {
  userId: string;
  usageDate: string;
  limitSeconds: number;
}) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("tts_daily_usage")
    .upsert(
      {
        user_id: params.userId,
        usage_date: params.usageDate,
        seconds_used: 0,
        limit_seconds: params.limitSeconds,
      } as never,
      { onConflict: "user_id,usage_date", ignoreDuplicates: true },
    );

  if (error) {
    throw error;
  }
}

async function getExistingTtsPlayEvent(params: {
  userId: string;
  sessionId: string;
  contentHash: string;
  chunkIndex: number;
}) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("tts_play_events")
    .select("id, charged_seconds")
    .eq("user_id", params.userId)
    .eq("session_id", params.sessionId)
    .eq("content_hash", params.contentHash)
    .eq("chunk_index", params.chunkIndex)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as { id: string; charged_seconds: number } | null;
}

function buildQuotaState(params: {
  allowed: boolean;
  alreadyConsumed?: boolean;
  secondsUsed: number;
  limitSeconds: number;
  chargedSeconds?: number;
  code?: string;
}): TtsQuotaState {
  return {
    allowed: params.allowed,
    alreadyConsumed: params.alreadyConsumed ?? false,
    secondsUsed: params.secondsUsed,
    remainingSeconds: Math.max(params.limitSeconds - params.secondsUsed, 0),
    limitSeconds: params.limitSeconds,
    chargedSeconds: params.chargedSeconds ?? 0,
    code: params.code,
  };
}

async function reserveTtsPlayEvent(params: {
  userId: string;
  lectureId: string;
  sessionId: string;
  contentHash: string;
  chunkIndex: number;
  usageDate: string;
}) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("tts_play_events")
    .insert(
      {
        user_id: params.userId,
        lecture_id: params.lectureId,
        session_id: params.sessionId,
        content_hash: params.contentHash,
        chunk_index: params.chunkIndex,
        usage_date: params.usageDate,
        charged_seconds: 0,
      } as never,
    )
    .select("id")
    .single();

  if (isUniqueConstraintError(error)) {
    return null;
  }

  if (error) {
    throw error;
  }

  return (data as { id: string }).id;
}

async function removeTtsPlayReservation(id: string) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("tts_play_events")
    .delete()
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function markTtsPlayEventCharged(params: { id: string; chargedSeconds: number }) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("tts_play_events")
    .update({ charged_seconds: params.chargedSeconds } as never)
    .eq("id", params.id);

  if (error) {
    throw error;
  }
}

export async function consumeTtsQuota(params: {
  userId: string;
  lectureId: string;
  sessionId: string;
  contentHash: string;
  chunkIndex: number;
  chargedSeconds: number;
  hasPaidAccess: boolean;
  hasUnlimitedUsage?: boolean;
}) {
  if (params.hasUnlimitedUsage) {
    return buildQuotaState({
      allowed: true,
      secondsUsed: 0,
      limitSeconds: UNLIMITED_TTS_USAGE_SECONDS,
      chargedSeconds: 0,
    });
  }

  const limitSeconds = getTtsDailyLimitSeconds(params.hasPaidAccess);
  const usageDate = getLjubljanaUsageDate();
  const chargedSeconds = Math.max(1, Math.ceil(params.chargedSeconds));
  const existingEvent = await getExistingTtsPlayEvent({
    userId: params.userId,
    sessionId: params.sessionId,
    contentHash: params.contentHash,
    chunkIndex: params.chunkIndex,
  });

  if (existingEvent && existingEvent.charged_seconds > 0) {
    const usage = await getTtsUsageState({
      userId: params.userId,
      hasPaidAccess: params.hasPaidAccess,
    });

    return buildQuotaState({
      allowed: true,
      alreadyConsumed: true,
      secondsUsed: usage.secondsUsed,
      limitSeconds: usage.limitSeconds,
      chargedSeconds: 0,
    });
  }

  if (existingEvent) {
    await removeTtsPlayReservation(existingEvent.id);
  }

  await ensureTtsUsageRow({
    userId: params.userId,
    usageDate,
    limitSeconds,
  });

  const reservationId = await reserveTtsPlayEvent({
    userId: params.userId,
    lectureId: params.lectureId,
    sessionId: params.sessionId,
    contentHash: params.contentHash,
    chunkIndex: params.chunkIndex,
    usageDate,
  });

  if (!reservationId) {
    const usage = await getTtsUsageState({
      userId: params.userId,
      hasPaidAccess: params.hasPaidAccess,
    });

    return buildQuotaState({
      allowed: true,
      alreadyConsumed: true,
      secondsUsed: usage.secondsUsed,
      limitSeconds: usage.limitSeconds,
      chargedSeconds: 0,
    });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const usage = await readTtsUsageRow({
      userId: params.userId,
      usageDate,
    });
    const secondsUsed = usage?.seconds_used ?? 0;
    const nextSecondsUsed = secondsUsed + chargedSeconds;

    if (nextSecondsUsed > limitSeconds) {
      await removeTtsPlayReservation(reservationId);

      return buildQuotaState({
        allowed: false,
        secondsUsed,
        limitSeconds,
        code: "tts_daily_limit_reached",
      });
    }

    const { data, error } = await createSupabaseServiceRoleClient()
      .from("tts_daily_usage")
      .update(
        {
          seconds_used: nextSecondsUsed,
          limit_seconds: limitSeconds,
        } as never,
      )
      .eq("user_id", params.userId)
      .eq("usage_date", usageDate)
      .eq("seconds_used", secondsUsed)
      .select("seconds_used, limit_seconds")
      .maybeSingle();

    if (error) {
      await removeTtsPlayReservation(reservationId);
      throw error;
    }

    if (!data) {
      continue;
    }

    await markTtsPlayEventCharged({
      id: reservationId,
      chargedSeconds,
    });

    const updatedUsage = data as { seconds_used: number; limit_seconds: number };

    return buildQuotaState({
      allowed: true,
      secondsUsed: updatedUsage.seconds_used,
      limitSeconds: updatedUsage.limit_seconds,
      chargedSeconds,
    });
  }

  await removeTtsPlayReservation(reservationId);
  throw new Error("Could not reserve TTS quota after concurrent updates.");
}

function parseStoredAlignment(value: unknown): TtsAlignmentWord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const wordIndex = record.wordIndex;
    const startMs = record.startMs;
    const endMs = record.endMs;

    if (
      typeof wordIndex !== "number" ||
      typeof startMs !== "number" ||
      typeof endMs !== "number"
    ) {
      return [];
    }

    return [{ wordIndex, startMs, endMs }];
  });
}

async function transcribeGeneratedAudio(params: {
  audio: Uint8Array;
  language: string;
  clientReferenceId: string;
}) {
  const env = getServerEnv();
  const transcription = await getSonioxClient().stt.transcribe({
    model: env.SONIOX_MODEL,
    file: params.audio,
    filename: "note-read-aloud.mp3",
    language_hints: [params.language],
    language_hints_strict: true,
    wait: true,
    wait_options: {
      interval_ms: TTS_WAIT_INTERVAL_MS,
      timeout_ms: TTS_WAIT_TIMEOUT_MS,
    },
    client_reference_id: params.clientReferenceId,
    cleanup: ["file", "transcription"],
  });

  if (transcription.status !== "completed") {
    throw new Error(
      transcription.error_message ||
        `Soniox alignment transcription failed with status ${transcription.status}.`,
    );
  }

  return transcription.transcript ?? (await transcription.getTranscript());
}

async function generateTtsChunk(params: {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunk: NoteTtsChunkPlan;
  chunkWords: NoteTtsWord[];
  language: string;
  voice: NoteTtsVoice;
}) {
  const env = getServerEnv();
  const client = getSonioxClient();
  const audio = await client.tts.generate({
    text: params.chunk.text,
    model: env.SONIOX_TTS_MODEL,
    voice: params.voice,
    language: params.language,
    audio_format: TTS_OUTPUT_FORMAT,
    bitrate: TTS_OUTPUT_BITRATE,
  });
  const transcript = await transcribeGeneratedAudio({
    audio,
    language: params.language,
    clientReferenceId: `${params.lectureId}:${params.contentHash}:${params.chunk.chunkIndex}`,
  });
  const durationMs = Math.max(
    transcript?.tokens.reduce((max, token) => Math.max(max, token.end_ms), 0) ?? 0,
    params.chunk.estimatedSeconds * 1000,
  );
  const alignment = alignTtsTokensToWords({
    words: params.chunkWords,
    tokens: transcript?.tokens ?? [],
    wordStartIndex: params.chunk.wordStartIndex,
    durationMs,
  });
  const audioStoragePath = buildTtsStoragePath({
    userId: params.userId,
    lectureId: params.lectureId,
    contentHash: params.contentHash,
    chunkIndex: params.chunk.chunkIndex,
    model: env.SONIOX_TTS_MODEL,
    voice: params.voice,
  });
  const service = createSupabaseServiceRoleClient();
  const { error: uploadError } = await service.storage
    .from(STORAGE_BUCKET)
    .upload(audioStoragePath, Buffer.from(audio), {
      contentType: TTS_OUTPUT_MIME_TYPE,
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data, error } = await service
    .from("lecture_tts_chunks")
    .upsert(
      {
        lecture_id: params.lectureId,
        content_hash: params.contentHash,
        chunk_index: params.chunk.chunkIndex,
        text: params.chunk.text,
        word_start_index: params.chunk.wordStartIndex,
        word_end_index: params.chunk.wordEndIndex,
        language: params.language,
        voice: params.voice,
        model: env.SONIOX_TTS_MODEL,
        audio_storage_path: audioStoragePath,
        audio_mime_type: TTS_OUTPUT_MIME_TYPE,
        duration_ms: Math.ceil(durationMs),
        alignment_json: alignment as unknown as Json,
      } as never,
      {
        onConflict: "lecture_id,content_hash,chunk_index,language,voice,model",
      },
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as LectureTtsChunkRow;
}

export async function getOrCreateTtsChunk(params: {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunk: NoteTtsChunkPlan;
  allWords: NoteTtsWord[];
  languageHint: string | null;
  voice?: NoteTtsVoice;
}) {
  const env = getServerEnv();
  const language = normalizeNoteLanguage(params.languageHint);
  const voice = params.voice ?? DEFAULT_NOTE_TTS_VOICE;
  const service = createSupabaseServiceRoleClient();
  const { data: cached, error: cacheError } = await service
    .from("lecture_tts_chunks")
    .select("*")
    .eq("lecture_id", params.lectureId)
    .eq("content_hash", params.contentHash)
    .eq("chunk_index", params.chunk.chunkIndex)
    .eq("language", language)
    .eq("voice", voice)
    .eq("model", env.SONIOX_TTS_MODEL)
    .maybeSingle();

  if (cacheError) {
    throw cacheError;
  }

  const row =
    ((cached as LectureTtsChunkRow | null) ??
    (await generateTtsChunk({
      userId: params.userId,
      lectureId: params.lectureId,
      contentHash: params.contentHash,
      chunk: params.chunk,
      chunkWords: params.allWords.slice(params.chunk.wordStartIndex, params.chunk.wordEndIndex),
      language,
      voice,
    })));
  const { data: signedUrl, error: signedUrlError } = await service.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(row.audio_storage_path, 10 * 60);

  if (signedUrlError || !signedUrl?.signedUrl) {
    throw signedUrlError ?? new Error("Could not create a signed TTS audio URL.");
  }

  return {
    row: row as LectureTtsChunkRow,
    audioUrl: signedUrl.signedUrl,
    alignment: parseStoredAlignment(row.alignment_json),
  };
}
