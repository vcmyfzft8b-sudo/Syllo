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

export function lectureShowsTranscript(params: {
  lecture: Pick<LectureRow, "source_type" | "processing_metadata">;
  artifact?: Pick<LectureArtifactRow, "model_metadata"> | null;
}) {
  return (
    params.lecture.source_type === "audio" ||
    isScanLectureMetadata(params.lecture.processing_metadata) ||
    isScanArtifactMetadata(params.artifact?.model_metadata)
  );
}
