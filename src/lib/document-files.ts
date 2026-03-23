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
