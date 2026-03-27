import "server-only";

import {
  MAX_AUDIO_BYTES,
  MAX_DOCUMENT_BYTES,
  STORAGE_BUCKET,
} from "@/lib/constants";
import {
  getLowercaseExtension,
  isDocxDocument,
  isHtmlDocument,
  isPdfDocument,
  isPlainTextDocument,
  isRtfDocument,
} from "@/lib/document-files";
import {
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

const MAX_SIGNATURE_BYTES = 8192;
const MAX_TEXT_SNIFF_BYTES = 65536;

function startsWithBytes(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function findAscii(bytes: Uint8Array, pattern: string) {
  return Buffer.from(bytes).includes(pattern, 0, "latin1");
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function looksLikeText(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return false;
  }

  if (
    startsWithBytes(bytes, [0xff, 0xfe]) ||
    startsWithBytes(bytes, [0xfe, 0xff]) ||
    startsWithBytes(bytes, [0xef, 0xbb, 0xbf])
  ) {
    return true;
  }

  let suspiciousBytes = 0;

  for (const value of bytes) {
    if (value === 0) {
      return false;
    }

    const isAllowedControl = value === 9 || value === 10 || value === 13 || value === 12;
    const isPrintableAscii = value >= 32 && value <= 126;
    const isExtendedByte = value >= 128;

    if (!isAllowedControl && !isPrintableAscii && !isExtendedByte) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / bytes.length < 0.05;
}

function isPdfSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
}

function isZipSignature(bytes: Uint8Array) {
  return (
    startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08])
  );
}

function isDocxSignature(bytes: Uint8Array) {
  return (
    isZipSignature(bytes) &&
    findAscii(bytes, "[Content_Types].xml") &&
    findAscii(bytes, "word/document.xml")
  );
}

function isRtfSignature(bytes: Uint8Array) {
  const text = decodeUtf8(bytes.slice(0, 32)).trimStart();
  return text.startsWith("{\\rtf");
}

function isHtmlSignature(bytes: Uint8Array) {
  const text = decodeUtf8(bytes).trimStart().toLowerCase();
  return (
    text.startsWith("<!doctype html") ||
    text.startsWith("<html") ||
    text.includes("<body") ||
    text.includes("<head") ||
    /<(div|p|section|article|h1|h2|title|meta)\b/.test(text)
  );
}

function isPlainTextSignature(bytes: Uint8Array) {
  return looksLikeText(bytes);
}

function isMp3Signature(bytes: Uint8Array) {
  if (startsWithBytes(bytes, [0x49, 0x44, 0x33])) {
    return true;
  }

  if (bytes.length < 2) {
    return false;
  }

  const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  const layerBits = (bytes[1] >> 1) & 0x03;
  return frameSync && layerBits !== 0;
}

function isAacSignature(bytes: Uint8Array) {
  if (bytes.length < 2) {
    return false;
  }

  return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

function isWavSignature(bytes: Uint8Array) {
  return (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    findAscii(bytes.slice(8, 16), "WAVE")
  );
}

function isAiffSignature(bytes: Uint8Array) {
  return (
    startsWithBytes(bytes, [0x46, 0x4f, 0x52, 0x4d]) &&
    (findAscii(bytes.slice(8, 16), "AIFF") || findAscii(bytes.slice(8, 16), "AIFC"))
  );
}

function isFlacSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x66, 0x4c, 0x61, 0x43]);
}

function isOggSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x4f, 0x67, 0x67, 0x53]);
}

function isWebmSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && findAscii(bytes, "webm");
}

function isCafSignature(bytes: Uint8Array) {
  return startsWithBytes(bytes, [0x63, 0x61, 0x66, 0x66]);
}

function isMp4FamilySignature(bytes: Uint8Array) {
  if (bytes.length < 12) {
    return false;
  }

  return decodeUtf8(bytes.slice(4, 8)) === "ftyp";
}

function matchesExpectedAudioSignature(bytes: Uint8Array, fileExtension: string) {
  switch (fileExtension) {
    case "mp3":
    case "mpga":
    case "mpeg":
      return isMp3Signature(bytes);
    case "aac":
      return isAacSignature(bytes) || isMp4FamilySignature(bytes);
    case "m4a":
    case "mp4":
      return isMp4FamilySignature(bytes);
    case "wav":
      return isWavSignature(bytes);
    case "webm":
      return isWebmSignature(bytes);
    case "ogg":
    case "oga":
    case "opus":
      return isOggSignature(bytes);
    case "flac":
      return isFlacSignature(bytes);
    case "caf":
      return isCafSignature(bytes);
    case "aif":
    case "aiff":
      return isAiffSignature(bytes);
    default:
      return false;
  }
}

export async function validateDocumentFileSignature(file: File) {
  if (file.size <= 0) {
    return {
      ok: false,
      error: "The uploaded document is empty.",
    };
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: "The document file is too large. The current limit is 4 MB.",
    };
  }

  const sniffBytes = new Uint8Array(
    await file.slice(0, Math.min(file.size, MAX_TEXT_SNIFF_BYTES)).arrayBuffer(),
  );

  if (isPdfDocument(file)) {
    return isPdfSignature(sniffBytes)
      ? { ok: true }
      : { ok: false, error: "The uploaded file is not a valid PDF." };
  }

  if (isDocxDocument(file)) {
    const documentBytes = new Uint8Array(await file.arrayBuffer());

    return isDocxSignature(documentBytes)
      ? { ok: true }
      : { ok: false, error: "The uploaded file is not a valid DOCX document." };
  }

  if (isRtfDocument(file)) {
    return isRtfSignature(sniffBytes)
      ? { ok: true }
      : { ok: false, error: "The uploaded file is not a valid RTF document." };
  }

  if (isHtmlDocument(file)) {
    return looksLikeText(sniffBytes) && isHtmlSignature(sniffBytes)
      ? { ok: true }
      : { ok: false, error: "The uploaded file is not a valid HTML document." };
  }

  if (isPlainTextDocument(file)) {
    return isPlainTextSignature(sniffBytes)
      ? { ok: true }
      : { ok: false, error: "The uploaded text file contains unsupported binary data." };
  }

  return {
    ok: false,
    error: "Unsupported document type. Use PDF, TXT, Markdown, HTML, RTF, or DOCX.",
  };
}

async function fetchStorageObjectHead(path: string) {
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not inspect the uploaded audio file.");
  }

  const response = await fetch(data.signedUrl, {
    headers: {
      Range: `bytes=0-${MAX_SIGNATURE_BYTES - 1}`,
    },
    cache: "no-store",
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Could not inspect uploaded audio file (${response.status}).`);
  }

  const contentRange = response.headers.get("content-range");
  const contentLength = response.headers.get("content-length");
  const totalBytes =
    (contentRange ? Number.parseInt(contentRange.split("/")[1] ?? "", 10) : Number.NaN) ||
    Number.parseInt(contentLength ?? "", 10);

  const headBytes = new Uint8Array(await response.arrayBuffer());

  return {
    totalBytes,
    headBytes,
  };
}

export async function validateStoredAudioFile(params: { path: string }) {
  const { totalBytes, headBytes } = await fetchStorageObjectHead(params.path);

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return {
      ok: false,
      error: "The uploaded audio file could not be inspected.",
    };
  }

  if (totalBytes > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: "The audio file is too large. The current limit is 300 MB.",
    };
  }

  const extension = getLowercaseExtension(params.path);

  if (!matchesExpectedAudioSignature(headBytes, extension)) {
    return {
      ok: false,
      error: `The uploaded audio file does not match the expected .${extension} format.`,
    };
  }

  return {
    ok: true,
    sizeBytes: totalBytes,
  };
}
