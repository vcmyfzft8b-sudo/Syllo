import { STORAGE_BUCKET, SUPPORTED_AUDIO_MIME_TYPES } from "@/lib/constants";

const mimeTypeAliasMap = new Map<string, string>([
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-m4a", "audio/m4a"],
  ["video/mp4", "audio/mp4"],
  ["video/webm", "audio/webm"],
  ["video/ogg", "audio/ogg"],
]);

const extensionMap = new Map<string, string>([
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
]);

export function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().trim();
  const baseType = normalized.split(";")[0]?.trim() ?? normalized;

  return mimeTypeAliasMap.get(baseType) ?? baseType;
}

export function isSupportedAudioMimeType(mimeType: string) {
  return SUPPORTED_AUDIO_MIME_TYPES.includes(
    normalizeMimeType(mimeType) as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number],
  );
}

export function getExtensionForMimeType(mimeType: string) {
  return extensionMap.get(normalizeMimeType(mimeType)) ?? "webm";
}

export function buildLectureStoragePath(params: {
  userId: string;
  lectureId: string;
  mimeType: string;
}) {
  const ext = getExtensionForMimeType(params.mimeType);
  return `${params.userId}/${params.lectureId}.${ext}`;
}

export function buildLectureChunkStoragePath(params: {
  userId: string;
  lectureId: string;
  index: number;
  mimeType: string;
}) {
  const ext = getExtensionForMimeType(params.mimeType);
  return `${params.userId}/${params.lectureId}/chunks/chunk-${String(params.index).padStart(3, "0")}.${ext}`;
}

export function buildStorageObjectUrl(path: string) {
  return `${STORAGE_BUCKET}/${path}`;
}
