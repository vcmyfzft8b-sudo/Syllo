import {
  STORAGE_BUCKET,
  SUPPORTED_AUDIO_MIME_TYPES,
} from "@/lib/constants";

const mimeTypeAliasMap = new Map<string, string>([
  ["audio/mp3", "audio/mpeg"],
  ["audio/mpga", "audio/mpeg"],
  ["audio/mpeg3", "audio/mpeg"],
  ["audio/x-m4a", "audio/m4a"],
  ["audio/x-aac", "audio/aac"],
  ["audio/x-wav", "audio/wav"],
  ["video/mp4", "audio/mp4"],
  ["video/webm", "audio/webm"],
  ["video/ogg", "audio/ogg"],
  ["application/ogg", "audio/ogg"],
  ["audio/x-flac", "audio/flac"],
  ["audio/x-aiff", "audio/aiff"],
  ["audio/x-caf", "audio/x-caf"],
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
  ["audio/opus", "opus"],
  ["audio/flac", "flac"],
  ["audio/aiff", "aiff"],
  ["audio/x-caf", "caf"],
]);

const extensionToMimeTypeMap = new Map<string, string>([
  ["mp3", "audio/mpeg"],
  ["mpga", "audio/mpeg"],
  ["mpeg", "audio/mpeg"],
  ["m4a", "audio/m4a"],
  ["mp4", "audio/mp4"],
  ["aac", "audio/aac"],
  ["wav", "audio/wav"],
  ["webm", "audio/webm"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/opus"],
  ["flac", "audio/flac"],
  ["caf", "audio/x-caf"],
  ["aif", "audio/aiff"],
  ["aiff", "audio/aiff"],
]);

const supportedAudioExtensions = new Set(extensionMap.values());

function getExtensionFromFileName(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

export function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().trim();
  const baseType = normalized.split(";")[0]?.trim() ?? normalized;

  return mimeTypeAliasMap.get(baseType) ?? baseType;
}

export function inferAudioMimeTypeFromFile(params: {
  mimeType: string;
  fileName?: string | null;
}) {
  const normalizedMimeType = normalizeMimeType(params.mimeType);

  if (
    normalizedMimeType &&
    normalizedMimeType !== "application/octet-stream" &&
    normalizedMimeType !== "binary/octet-stream"
  ) {
    return normalizedMimeType;
  }

  const extension = getExtensionFromFileName(params.fileName ?? "");
  return extensionToMimeTypeMap.get(extension) ?? normalizedMimeType;
}

export function isSupportedAudioMimeType(mimeType: string, fileName?: string | null) {
  const normalizedMimeType = inferAudioMimeTypeFromFile({
    mimeType,
    fileName,
  });

  return SUPPORTED_AUDIO_MIME_TYPES.includes(
    normalizedMimeType as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number],
  );
}

export function normalizeUploadAudioMimeType(params: {
  mimeType: string;
  fileName?: string | null;
}) {
  return inferAudioMimeTypeFromFile(params);
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

export function isCanonicalLectureStoragePath(params: {
  path: string;
  userId: string;
  lectureId: string;
}) {
  const expectedPrefix = `${params.userId}/${params.lectureId}.`;

  if (!params.path.startsWith(expectedPrefix)) {
    return false;
  }

  const extension = params.path.slice(expectedPrefix.length).toLowerCase();

  if (!extension || extension.includes("/")) {
    return false;
  }

  return supportedAudioExtensions.has(extension);
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
