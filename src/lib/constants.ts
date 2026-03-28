export const STORAGE_BUCKET = "lecture-audio";

export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 3 * 60 * 60;
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = MAX_PDF_BYTES;
export const MAX_SCAN_IMAGE_BYTES = 8 * 1024 * 1024;

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mpga",
  "audio/mpeg3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/x-aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/aiff",
  "audio/x-aiff",
  "audio/x-caf",
] as const;

export const SUPPORTED_AUDIO_EXTENSIONS = [
  "mp3",
  "mpga",
  "mpeg",
  "m4a",
  "mp4",
  "aac",
  "wav",
  "webm",
  "ogg",
  "oga",
  "opus",
  "flac",
  "caf",
  "aif",
  "aiff",
] as const;

export const AUDIO_FILE_INPUT_ACCEPT = [
  "audio/*",
  ...SUPPORTED_AUDIO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "application/rtf",
  "text/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "rtf",
  "docx",
] as const;

export const DOCUMENT_FILE_INPUT_ACCEPT = [
  ...SUPPORTED_DOCUMENT_MIME_TYPES,
  ...SUPPORTED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export const SCAN_IMAGE_INPUT_ACCEPT = "image/*";

export const LECTURE_STATUS = [
  "uploading",
  "queued",
  "transcribing",
  "generating_notes",
  "ready",
  "failed",
] as const;

export const POLL_INTERVAL_MS = 4000;
export const CHAT_MATCH_COUNT = 6;
