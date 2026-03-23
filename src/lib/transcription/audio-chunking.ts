import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LONG_AUDIO_THRESHOLD_SECONDS = 12 * 60;
const LONG_AUDIO_THRESHOLD_BYTES = 20 * 1024 * 1024;
const CHUNK_DURATION_SECONDS = 12 * 60;
const CHUNK_OVERLAP_SECONDS = 15;

export type AudioChunk = {
  index: number;
  startMs: number;
  endMs: number;
  file: File;
};

let ffmpegAvailability: boolean | null = null;

function sanitizeExtension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "bin";
}

function buildChunkWindows(durationSeconds: number) {
  const windows: Array<{ startSeconds: number; durationSeconds: number }> = [];

  if (durationSeconds <= CHUNK_DURATION_SECONDS) {
    windows.push({
      startSeconds: 0,
      durationSeconds,
    });
    return windows;
  }

  const stepSeconds = CHUNK_DURATION_SECONDS - CHUNK_OVERLAP_SECONDS;

  for (let startSeconds = 0; startSeconds < durationSeconds; startSeconds += stepSeconds) {
    const endSeconds = Math.min(startSeconds + CHUNK_DURATION_SECONDS, durationSeconds);

    windows.push({
      startSeconds,
      durationSeconds: Math.max(endSeconds - startSeconds, 1),
    });

    if (endSeconds >= durationSeconds) {
      break;
    }
  }

  return windows;
}

export function shouldChunkAudio(file: File, durationSeconds?: number | null) {
  if (file.size >= LONG_AUDIO_THRESHOLD_BYTES) {
    return true;
  }

  if (!durationSeconds) {
    return false;
  }

  return durationSeconds >= LONG_AUDIO_THRESHOLD_SECONDS;
}

export async function hasFfmpegBinary() {
  if (ffmpegAvailability !== null) {
    return ffmpegAvailability;
  }

  try {
    await execFileAsync("ffmpeg", ["-version"]);
    ffmpegAvailability = true;
  } catch {
    ffmpegAvailability = false;
  }

  return ffmpegAvailability;
}

export async function splitAudioIntoChunks(input: {
  file: File;
  durationSeconds: number;
}) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "memo-audio-"));
  const sourceExtension = sanitizeExtension(input.file.name);
  const sourcePath = join(tempDirectory, `source.${sourceExtension}`);
  const sourceBytes = Buffer.from(await input.file.arrayBuffer());

  await writeFile(sourcePath, sourceBytes);

  try {
    const chunks: AudioChunk[] = [];
    const windows = buildChunkWindows(input.durationSeconds);

    for (const [index, window] of windows.entries()) {
      const outputPath = join(tempDirectory, `chunk-${index}.mp3`);

      await execFileAsync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-ss",
        window.startSeconds.toString(),
        "-t",
        window.durationSeconds.toString(),
        "-i",
        sourcePath,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "32k",
        outputPath,
      ]);

      const chunkBytes = await readFile(outputPath);
      const startMs = Math.round(window.startSeconds * 1000);
      const endMs = Math.round((window.startSeconds + window.durationSeconds) * 1000);

      chunks.push({
        index,
        startMs,
        endMs,
        file: new File([chunkBytes], `chunk-${index}.mp3`, {
          type: "audio/mpeg",
        }),
      });
    }

    return chunks;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
