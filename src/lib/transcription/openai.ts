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

function resolveTranscriptionModel(configuredModel: string) {
  const normalized = configuredModel.trim();
  return normalized.length > 0 ? normalized : DIARIZATION_MODEL;
}

type TranscriptionAttempt = {
  model: string;
  responseFormat: AudioResponseFormat;
};

function buildAttemptList(configuredModel: string): TranscriptionAttempt[] {
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

  const resolvedModel = resolveTranscriptionModel(configuredModel);

  if (resolvedModel.includes("diarize")) {
    addAttempt(resolvedModel, "diarized_json");
    addAttempt(PRIMARY_FALLBACK_MODEL, "json");
    addAttempt(SECONDARY_FALLBACK_MODEL, "json");
    addAttempt(LAST_RESORT_MODEL, "verbose_json");
    return attempts;
  }

  addAttempt(configuredModel, configuredModel === LAST_RESORT_MODEL ? "verbose_json" : "json");
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

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
  }): Promise<TranscriptResult> {
    const openai = getOpenAiClient();
    const env = getServerEnv();
    const attempts = buildAttemptList(env.OPENAI_TRANSCRIPTION_MODEL);
    const fileBytes = await input.file.arrayBuffer();
    const errors: string[] = [];

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

        return mapPlainTranscript(transcription as Transcription, input.durationSeconds);
      } catch (error) {
        errors.push(`${attempt.model}/${attempt.responseFormat}: ${normalizeTranscriptionError(error)}`);
      }
    }

    throw new Error(`Audio transcription failed. ${errors.join(" | ")}`);
  }
}
