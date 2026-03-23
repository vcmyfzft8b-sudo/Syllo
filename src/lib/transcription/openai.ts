import "server-only";

import OpenAI from "openai";
import type {
  Transcription,
  TranscriptionDiarized,
  TranscriptionVerbose,
} from "openai/resources/audio/transcriptions";
import type { AudioResponseFormat } from "openai/resources/audio/audio";

import { getOpenAiClient } from "@/lib/ai/openai";
import { getServerEnv } from "@/lib/server-env";
import type { TranscriptResult } from "@/lib/types";
import {
  hasFfmpegBinary,
  shouldChunkAudio,
  splitAudioIntoChunks,
} from "@/lib/transcription/audio-chunking";
import type { TranscriptionProvider } from "@/lib/transcription/types";

function fallbackSegments(text: string, durationSeconds: number): TranscriptResult["segments"] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const slice = Math.max(1, Math.floor((durationSeconds * 1000) / Math.max(parts.length, 1)));

  return parts.map((part, index) => ({
    idx: index,
    startMs: index * slice,
    endMs: (index + 1) * slice,
    speakerLabel: null,
    text: part,
  }));
}

const DIARIZATION_MODEL = "gpt-4o-transcribe-diarize";
const PRIMARY_FALLBACK_MODEL = "gpt-4o-transcribe";
const SECONDARY_FALLBACK_MODEL = "gpt-4o-mini-transcribe";
const LAST_RESORT_MODEL = "whisper-1";
const LONG_AUDIO_FAST_MODEL_THRESHOLD_SECONDS = 10 * 60;
const OPENAI_TRANSCRIPTION_TIMEOUT_MS = 240_000;
const TIMESTAMP_REQUIRED_DURATION_SECONDS = 60;

function resolveTranscriptionModel(configuredModel: string) {
  const normalized = configuredModel.trim();
  return normalized.length > 0 ? normalized : DIARIZATION_MODEL;
}

type TranscriptionAttempt = {
  model: string;
  responseFormat: AudioResponseFormat;
};

function buildAttemptList(params: {
  configuredModel: string;
  durationSeconds?: number | null;
}): TranscriptionAttempt[] {
  const attempts: TranscriptionAttempt[] = [];
  const seen = new Set<string>();

  function addAttempt(model: string, responseFormat: AudioResponseFormat) {
    const normalizedModel = model.trim();

    if (!normalizedModel) {
      return;
    }

    const key = `${normalizedModel}::${responseFormat}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    attempts.push({ model: normalizedModel, responseFormat });
  }

  const resolvedModel = resolveTranscriptionModel(params.configuredModel);
  const prefersFastLongAudioPath =
    resolvedModel.includes("diarize") &&
    (params.durationSeconds ?? 0) >= LONG_AUDIO_FAST_MODEL_THRESHOLD_SECONDS;
  const requiresPreciseTimestamps =
    (params.durationSeconds ?? 0) >= TIMESTAMP_REQUIRED_DURATION_SECONDS;

  if (prefersFastLongAudioPath) {
    addAttempt(LAST_RESORT_MODEL, "verbose_json");
    addAttempt(PRIMARY_FALLBACK_MODEL, "json");
    addAttempt(SECONDARY_FALLBACK_MODEL, "json");
    addAttempt(resolvedModel, "diarized_json");
    return attempts;
  }

  if (resolvedModel.includes("diarize")) {
    addAttempt(resolvedModel, "diarized_json");
    if (requiresPreciseTimestamps) {
      addAttempt(LAST_RESORT_MODEL, "verbose_json");
    }
    addAttempt(PRIMARY_FALLBACK_MODEL, "json");
    addAttempt(SECONDARY_FALLBACK_MODEL, "json");
    addAttempt(LAST_RESORT_MODEL, "verbose_json");
    return attempts;
  }

  addAttempt(
    params.configuredModel,
    params.configuredModel === LAST_RESORT_MODEL ? "verbose_json" : "json",
  );
  addAttempt(PRIMARY_FALLBACK_MODEL, "json");
  addAttempt(SECONDARY_FALLBACK_MODEL, "json");
  addAttempt(LAST_RESORT_MODEL, "verbose_json");

  return attempts;
}

function toSegmentDurationSeconds(durationSeconds: number | null | undefined, text: string) {
  const safeDuration = Math.round(durationSeconds ?? 0);
  return safeDuration > 0 ? safeDuration : Math.max(1, Math.ceil(text.split(/\s+/).length / 2.5));
}

function mapDiarizedTranscript(transcription: TranscriptionDiarized): TranscriptResult {
  const segments = transcription.segments.map((segment, index) => ({
    idx: index,
    startMs: Math.round(segment.start * 1000),
    endMs: Math.round(segment.end * 1000),
    speakerLabel: segment.speaker ?? null,
    text: segment.text.trim(),
  }));

  return {
    text: transcription.text,
    durationSeconds: Math.round(transcription.duration),
    segments:
      segments.length > 0
        ? segments
        : fallbackSegments(
            transcription.text,
            toSegmentDurationSeconds(transcription.duration, transcription.text),
          ),
  };
}

function mapVerboseTranscript(
  transcription: TranscriptionVerbose,
  fallbackDurationSeconds?: number | null,
): TranscriptResult {
  const segments =
    transcription.segments?.map((segment, index) => ({
      idx: index,
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      speakerLabel: null,
      text: segment.text.trim(),
    })) ?? [];

  const durationSeconds = toSegmentDurationSeconds(
    transcription.duration || fallbackDurationSeconds,
    transcription.text,
  );

  return {
    text: transcription.text,
    durationSeconds,
    segments:
      segments.length > 0
        ? segments
        : fallbackSegments(transcription.text, durationSeconds),
  };
}

function mapPlainTranscript(
  transcription: Transcription,
  fallbackDurationSeconds?: number | null,
): TranscriptResult {
  const durationSeconds = toSegmentDurationSeconds(fallbackDurationSeconds, transcription.text);

  return {
    text: transcription.text,
    durationSeconds,
    segments: fallbackSegments(transcription.text, durationSeconds),
  };
}

function normalizeTranscriptionError(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    return `${error.status ?? "OpenAI"} ${error.message}`.trim();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function transcribeSingleFile(
  openai: OpenAI,
  attempts: TranscriptionAttempt[],
  input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
  },
) {
  const fileBytes = await input.file.arrayBuffer();
  const errors: string[] = [];
  const requiresPreciseTimestamps =
    (input.durationSeconds ?? 0) >= TIMESTAMP_REQUIRED_DURATION_SECONDS;

  for (const attempt of attempts) {
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: new File([fileBytes], input.file.name, {
          type: input.file.type,
        }),
        model: attempt.model,
        language: input.languageHint ?? "sl",
        response_format: attempt.responseFormat,
        ...(attempt.responseFormat === "diarized_json" &&
        input.durationSeconds &&
        input.durationSeconds > 30
          ? { chunking_strategy: "auto" as const }
          : {}),
        ...(attempt.responseFormat === "verbose_json"
          ? { timestamp_granularities: ["segment"] }
          : {}),
      }, {
        timeout: OPENAI_TRANSCRIPTION_TIMEOUT_MS,
      });

      if (attempt.responseFormat === "diarized_json") {
        return mapDiarizedTranscript(transcription as TranscriptionDiarized);
      }

      if (attempt.responseFormat === "verbose_json") {
        return mapVerboseTranscript(
          transcription as TranscriptionVerbose,
          input.durationSeconds,
        );
      }

      if (requiresPreciseTimestamps) {
        throw new Error(
          `Model ${attempt.model} returned plain text without timestamps for long audio.`,
        );
      }

      return mapPlainTranscript(transcription as Transcription, input.durationSeconds);
    } catch (error) {
      errors.push(`${attempt.model}/${attempt.responseFormat}: ${normalizeTranscriptionError(error)}`);
    }
  }

  throw new Error(`Audio transcription failed. ${errors.join(" | ")}`);
}

function mergeChunkedTranscripts(
  chunks: Array<{
    startMs: number;
    endMs: number;
    transcript: TranscriptResult;
  }>,
  durationSeconds?: number | null,
): TranscriptResult {
  const mergedSegments: TranscriptResult["segments"] = [];
  let maxCoveredMs = 0;

  for (const chunk of chunks) {
    for (const segment of chunk.transcript.segments) {
      const adjustedStartMs = chunk.startMs + segment.startMs;
      const adjustedEndMs = Math.min(chunk.startMs + segment.endMs, chunk.endMs);
      const midpointMs = adjustedStartMs + Math.max(adjustedEndMs - adjustedStartMs, 0) / 2;

      if (midpointMs <= maxCoveredMs - 1000) {
        continue;
      }

      const nextStartMs = Math.max(
        adjustedStartMs,
        maxCoveredMs > 0 ? maxCoveredMs : adjustedStartMs,
      );
      const nextEndMs = Math.max(adjustedEndMs, nextStartMs);

      mergedSegments.push({
        idx: mergedSegments.length,
        startMs: nextStartMs,
        endMs: nextEndMs,
        speakerLabel: segment.speakerLabel,
        text: segment.text.trim(),
      });

      maxCoveredMs = Math.max(maxCoveredMs, nextEndMs);
    }
  }

  const filteredSegments = mergedSegments.filter((segment) => segment.text.length > 0);

  return {
    text: filteredSegments.map((segment) => segment.text).join(" ").trim(),
    durationSeconds: Math.max(
      Math.round(maxCoveredMs / 1000),
      Math.round(durationSeconds ?? 0),
    ),
    segments: filteredSegments.map((segment, index) => ({
      ...segment,
      idx: index,
    })),
  };
}

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  private async transcribeChunkCollection(input: {
    chunks: Array<{
      file: File;
      startMs: number;
      endMs: number;
    }>;
    languageHint: string | null;
    durationSeconds?: number | null;
  }) {
    const openai = getOpenAiClient();
    const env = getServerEnv();
    const attempts = buildAttemptList({
      configuredModel: env.OPENAI_TRANSCRIPTION_MODEL,
      durationSeconds: input.durationSeconds,
    });
    const transcripts = [];

    for (const chunk of input.chunks) {
      const transcript = await transcribeSingleFile(openai, attempts, {
        file: chunk.file,
        languageHint: input.languageHint,
        durationSeconds: Math.max((chunk.endMs - chunk.startMs) / 1000, 1),
      });

      transcripts.push({
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        transcript,
      });
    }

    return mergeChunkedTranscripts(transcripts, input.durationSeconds);
  }

  async transcribe(input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
  }): Promise<TranscriptResult> {
    const openai = getOpenAiClient();
    const env = getServerEnv();
    const attempts = buildAttemptList({
      configuredModel: env.OPENAI_TRANSCRIPTION_MODEL,
      durationSeconds: input.durationSeconds,
    });
    const shouldUseChunking =
      shouldChunkAudio(input.file, input.durationSeconds) && (await hasFfmpegBinary());

    if (!shouldUseChunking || !input.durationSeconds) {
      return transcribeSingleFile(openai, attempts, input);
    }

    const chunkFiles = await splitAudioIntoChunks({
      file: input.file,
      durationSeconds: input.durationSeconds,
    });

    return this.transcribeChunkCollection({
      chunks: chunkFiles,
      languageHint: input.languageHint,
      durationSeconds: input.durationSeconds,
    });
  }

  async transcribeChunks(input: {
    chunks: Array<{
      file: File;
      startMs: number;
      endMs: number;
    }>;
    languageHint: string | null;
    durationSeconds?: number | null;
  }): Promise<TranscriptResult> {
    return this.transcribeChunkCollection(input);
  }
}
