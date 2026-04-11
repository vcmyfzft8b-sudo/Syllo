export function extractScanImageStoragePaths(processingMetadata: unknown) {
  if (
    !processingMetadata ||
    typeof processingMetadata !== "object" ||
    Array.isArray(processingMetadata)
  ) {
    return [];
  }

  const metadata = processingMetadata as Record<string, unknown>;
  const pendingScanImages = Array.isArray(metadata.pendingScanImages)
    ? metadata.pendingScanImages
    : [];
  const manualImport =
    metadata.manualImport && typeof metadata.manualImport === "object"
      ? (metadata.manualImport as Record<string, unknown>)
      : null;
  const modelMetadata =
    manualImport?.modelMetadata && typeof manualImport.modelMetadata === "object"
      ? (manualImport.modelMetadata as Record<string, unknown>)
      : null;
  const sourceImageUploads = Array.isArray(modelMetadata?.sourceImageUploads)
    ? modelMetadata.sourceImageUploads
    : [];

  return [...pendingScanImages, ...sourceImageUploads]
    .map((image) =>
      image && typeof image === "object" && "path" in image
        ? (image as { path?: unknown }).path
        : null,
    )
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}
