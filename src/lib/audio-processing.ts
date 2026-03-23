import type { Json } from "@/lib/database.types";

export const CLIENT_AUDIO_CHUNK_THRESHOLD_SECONDS = 12 * 60;
export const CLIENT_AUDIO_CHUNK_THRESHOLD_BYTES = 20 * 1024 * 1024;
export const CLIENT_AUDIO_CHUNK_DURATION_SECONDS = 12 * 60;
export const CLIENT_AUDIO_CHUNK_OVERLAP_SECONDS = 15;
export const CLIENT_AUDIO_CHUNK_MIME_TYPE = "audio/wav";

export type AudioChunkManifest = {
  index: number;
  path: string;
  mimeType: string;
  startMs: number;
  endMs: number;
};

function isRecord(value: unknown): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function shouldUseClientAudioChunking(params: {
  sizeBytes: number;
  durationSeconds: number;
}) {
  return (
    params.sizeBytes >= CLIENT_AUDIO_CHUNK_THRESHOLD_BYTES ||
    params.durationSeconds >= CLIENT_AUDIO_CHUNK_THRESHOLD_SECONDS
  );
}

export function buildChunkWindows(durationSeconds: number) {
  const windows: Array<{
    index: number;
    startSeconds: number;
    durationSeconds: number;
    startMs: number;
    endMs: number;
  }> = [];

  if (durationSeconds <= CLIENT_AUDIO_CHUNK_DURATION_SECONDS) {
    return [
      {
        index: 0,
        startSeconds: 0,
        durationSeconds,
        startMs: 0,
        endMs: Math.round(durationSeconds * 1000),
      },
    ];
  }

  const stepSeconds = CLIENT_AUDIO_CHUNK_DURATION_SECONDS - CLIENT_AUDIO_CHUNK_OVERLAP_SECONDS;
  let index = 0;

  for (let startSeconds = 0; startSeconds < durationSeconds; startSeconds += stepSeconds) {
    const endSeconds = Math.min(
      startSeconds + CLIENT_AUDIO_CHUNK_DURATION_SECONDS,
      durationSeconds,
    );

    windows.push({
      index,
      startSeconds,
      durationSeconds: Math.max(endSeconds - startSeconds, 1),
      startMs: Math.round(startSeconds * 1000),
      endMs: Math.round(endSeconds * 1000),
    });

    index += 1;

    if (endSeconds >= durationSeconds) {
      break;
    }
  }

  return windows;
}

export function parseAudioChunkManifest(value: unknown): AudioChunkManifest[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const index = typeof item.index === "number" ? item.index : null;
    const path = typeof item.path === "string" ? item.path : null;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : null;
    const startMs = typeof item.startMs === "number" ? item.startMs : null;
    const endMs = typeof item.endMs === "number" ? item.endMs : null;

    if (
      index == null ||
      path == null ||
      mimeType == null ||
      startMs == null ||
      endMs == null
    ) {
      return [];
    }

    return [
      {
        index,
        path,
        mimeType,
        startMs,
        endMs,
      },
    ];
  });
}
