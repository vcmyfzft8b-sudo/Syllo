import type { LectureArtifactRow, LectureRow } from "@/lib/database.types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isScanLectureMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return false;
  }

  if (Array.isArray(metadata.pendingScanImages) && metadata.pendingScanImages.length > 0) {
    return true;
  }

  const manualImport = metadata.manualImport;

  if (!isRecord(manualImport)) {
    return false;
  }

  const modelMetadata = manualImport.modelMetadata;

  return isRecord(modelMetadata) && modelMetadata.importMode === "scan";
}

export function isScanArtifactMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return false;
  }

  return (
    metadata.importMode === "scan" ||
    (Array.isArray(metadata.sourceImageUploads) && metadata.sourceImageUploads.length > 0)
  );
}

const MANUAL_SOURCE_TYPES = new Set(["text", "pdf", "link", "presentation"]);

export function getManualImportSourceType(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.manualImport)) {
    return null;
  }

  const sourceType = metadata.manualImport.sourceType;

  return typeof sourceType === "string" && MANUAL_SOURCE_TYPES.has(sourceType)
    ? sourceType
    : null;
}

export function getEffectiveLectureSourceType(
  lecture: Pick<LectureRow, "source_type" | "processing_metadata">,
) {
  return getManualImportSourceType(lecture.processing_metadata) ?? lecture.source_type;
}

export function lectureShowsTranscript(params: {
  lecture: Pick<LectureRow, "source_type" | "processing_metadata">;
  artifact?: Pick<LectureArtifactRow, "model_metadata"> | null;
}) {
  const sourceType = getEffectiveLectureSourceType(params.lecture);

  return (
    sourceType === "audio" ||
    isScanLectureMetadata(params.lecture.processing_metadata) ||
    isScanArtifactMetadata(params.artifact?.model_metadata)
  );
}
