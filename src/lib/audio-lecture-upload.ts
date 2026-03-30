"use client";

import { STORAGE_BUCKET } from "@/lib/constants";
import {
  shouldUseClientAudioChunking,
  type AudioChunkManifest,
} from "@/lib/audio-processing";
import { createAudioProcessingChunks } from "@/lib/audio-processing-client";
import { parseApiResponse } from "@/lib/billing-client";
import { normalizeUploadAudioMimeType } from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { CreateLectureResponse } from "@/lib/types";

type UploadStage =
  | "creating"
  | "uploading-original"
  | "preparing-chunks"
  | "uploading-chunks"
  | "finalizing";

type ChunkUploadResponse = {
  uploads: Array<{
    index: number;
    path: string;
    token: string;
  }>;
};

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Upload was aborted.", "AbortError");
  }
}

export async function createAudioLectureWithProcessingChunks(params: {
  file: File;
  durationSeconds: number;
  languageHint: string;
  onStageChange?: (stage: UploadStage, message: string) => void;
  onLectureCreated?: (lectureId: string) => void;
  signal?: AbortSignal;
}) {
  const normalizedMimeType = normalizeUploadAudioMimeType({
    mimeType: params.file.type || "application/octet-stream",
    fileName: params.file.name,
  });
  const supabase = createSupabaseBrowserClient();

  assertNotAborted(params.signal);
  params.onStageChange?.("creating", "Preparing...");

  const createResponse = await fetch("/api/lectures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify({
      mimeType: normalizedMimeType,
      fileName: params.file.name,
      size: params.file.size,
      durationSeconds: Math.max(params.durationSeconds, 1),
      languageHint: params.languageHint,
    }),
  });

  const createData = await parseApiResponse<CreateLectureResponse>(createResponse);

  params.onLectureCreated?.(createData.lectureId);

  assertNotAborted(params.signal);
  params.onStageChange?.("uploading-original", "Uploading audio...");

  const originalUpload = await supabase.storage
    .from(STORAGE_BUCKET)
    .uploadToSignedUrl(createData.path, createData.token, params.file, {
      contentType: normalizedMimeType,
      upsert: true,
    });

  if (originalUpload.error) {
    throw new Error(originalUpload.error.message);
  }

  const shouldChunk = shouldUseClientAudioChunking({
    sizeBytes: params.file.size,
    durationSeconds: params.durationSeconds,
  });

  if (shouldChunk) {
    try {
      assertNotAborted(params.signal);
      params.onStageChange?.("preparing-chunks", "Preparing audio chunks...");

      const chunks = await createAudioProcessingChunks({
        file: params.file,
        durationSeconds: params.durationSeconds,
        signal: params.signal,
        onProgress: (message) => params.onStageChange?.("preparing-chunks", message),
      });

      const manifestResponse = await fetch(`/api/lectures/${createData.lectureId}/chunks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: params.signal,
        body: JSON.stringify({
          chunks: chunks.map((chunk) => ({
            index: chunk.index,
            mimeType: chunk.mimeType,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
          })),
        }),
      });

      const manifestData = await parseApiResponse<ChunkUploadResponse>(manifestResponse);

      const uploadsByIndex = new Map(
        manifestData.uploads.map((upload) => [upload.index, upload] as const),
      );

      for (const [position, chunk] of chunks.entries()) {
        assertNotAborted(params.signal);
        params.onStageChange?.(
          "uploading-chunks",
          `Uploading audio chunks (${position + 1}/${chunks.length})...`,
        );

        const uploadTarget = uploadsByIndex.get(chunk.index);

        if (!uploadTarget) {
          throw new Error(`Missing upload target for chunk ${chunk.index}.`);
        }

        const uploadResult = await supabase.storage
          .from(STORAGE_BUCKET)
          .uploadToSignedUrl(uploadTarget.path, uploadTarget.token, chunk.file, {
            contentType: chunk.mimeType,
            upsert: true,
          });

        if (uploadResult.error) {
          throw new Error(uploadResult.error.message);
        }
      }
    } catch (chunkError) {
      if (params.signal?.aborted) {
        throw chunkError;
      }

      console.warn("Client audio chunking failed; falling back to original upload.", chunkError);
    }
  }

  assertNotAborted(params.signal);
  params.onStageChange?.("finalizing", "Starting processing...");

  const finalizeResponse = await fetch(`/api/lectures/${createData.lectureId}/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify({
      path: createData.path,
    }),
  });

  await parseApiResponse(finalizeResponse);

  return {
    lectureId: createData.lectureId,
    path: createData.path,
  };
}

export function parseAudioChunkPaths(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const chunk = item as AudioChunkManifest;
    return typeof chunk?.path === "string" ? [chunk.path] : [];
  });
}
