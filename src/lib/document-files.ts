import {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "@/lib/constants";

export function getLowercaseExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

export function normalizeDocumentMimeType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function createSafeTransportFileName(fileName: string) {
  const trimmed = fileName.trim();

  if (!trimmed) {
    return "document";
  }

  const lastDot = trimmed.lastIndexOf(".");
  const rawBaseName = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const rawExtension = lastDot > 0 ? trimmed.slice(lastDot + 1) : "";

  const normalizeSegment = (value: string) => {
    const normalized = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-._]+|[-._]+$/g, "");

    return normalized || "document";
  };

  const safeBaseName = normalizeSegment(rawBaseName);
  const safeExtension = rawExtension
    ? normalizeSegment(rawExtension).toLowerCase()
    : "";

  return safeExtension ? `${safeBaseName}.${safeExtension}` : safeBaseName;
}

export function isPdfDocument(file: Pick<File, "name" | "type">) {
  const mimeType = normalizeDocumentMimeType(file.type);
  return mimeType.includes("pdf") || getLowercaseExtension(file.name) === "pdf";
}

export function isDocxDocument(file: Pick<File, "name" | "type">) {
  const mimeType = normalizeDocumentMimeType(file.type);
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    getLowercaseExtension(file.name) === "docx"
  );
}

export function isHtmlDocument(file: Pick<File, "name" | "type">) {
  const mimeType = normalizeDocumentMimeType(file.type);
  const extension = getLowercaseExtension(file.name);
  return mimeType === "text/html" || extension === "html" || extension === "htm";
}

export function isRtfDocument(file: Pick<File, "name" | "type">) {
  const mimeType = normalizeDocumentMimeType(file.type);
  return (
    mimeType === "application/rtf" ||
    mimeType === "text/rtf" ||
    getLowercaseExtension(file.name) === "rtf"
  );
}

export function isPlainTextDocument(file: Pick<File, "name" | "type">) {
  const mimeType = normalizeDocumentMimeType(file.type);
  const extension = getLowercaseExtension(file.name);
  return (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/x-markdown" ||
    extension === "txt" ||
    extension === "md" ||
    extension === "markdown"
  );
}

export function isSupportedDocumentFile(file: Pick<File, "name" | "type">) {
  const mimeType = normalizeDocumentMimeType(file.type);
  const extension = getLowercaseExtension(file.name);

  return (
    SUPPORTED_DOCUMENT_MIME_TYPES.includes(
      mimeType as (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number],
    ) ||
    SUPPORTED_DOCUMENT_EXTENSIONS.includes(
      extension as (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number],
    )
  );
}
