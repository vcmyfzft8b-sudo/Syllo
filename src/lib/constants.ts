export const STORAGE_BUCKET = "lecture-audio";

export const MAX_AUDIO_BYTES = 150 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 2 * 60 * 60;
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
] as const;

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
