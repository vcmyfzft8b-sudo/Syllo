export type ScanOcrAttemptDiagnostics = {
  acceptable: boolean | null;
  errorMessage: string | null;
  maxOutputTokens: number;
  mediaResolution: "medium" | "high";
  model: string;
  outputLength: number | null;
  stage: "ocr_primary" | "ocr_rescue";
};

export type ScanOcrImageDiagnostics = {
  attempts: ScanOcrAttemptDiagnostics[];
  fileName: string;
  imageIndex: number | null;
  mimeType: string;
  sizeBytes: number;
};

export type ScanOcrDiagnostics = {
  imageCount: number;
  images: ScanOcrImageDiagnostics[];
  readableImageCount: number;
  skippedImageCount: number;
};

export class NoReadableScanTextError extends Error {
  diagnostics: ScanOcrDiagnostics;

  constructor(diagnostics: ScanOcrDiagnostics) {
    super("Na fotografiji ni bilo mogoče najti dovolj berljivega besedila.");
    this.name = "NoReadableScanTextError";
    this.diagnostics = diagnostics;
  }
}
