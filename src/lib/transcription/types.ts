import type { TranscriptResult } from "@/lib/types";

export type TranscriptionAttemptDiagnostics = {
  audioDurationMs: number | null;
  languageHints: string[];
  languageHintsStrict: boolean;
  status: string;
  transcriptLength: number;
};

export type TranscriptionDiagnostics = {
  provider: "soniox";
  model: string;
  file: {
    mimeType: string;
    sizeBytes: number;
  };
  attempts: TranscriptionAttemptDiagnostics[];
};

export class NoClearSpeechDetectedError extends Error {
  diagnostics: TranscriptionDiagnostics;

  constructor(diagnostics: TranscriptionDiagnostics) {
    super("V zvoku ni bilo mogoče zaznati dovolj jasnega govora. Preveri posnetek in poskusi znova.");
    this.name = "NoClearSpeechDetectedError";
    this.diagnostics = diagnostics;
  }
}

export interface TranscriptionProvider {
  transcribe(input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
  }): Promise<TranscriptResult>;
  transcribeChunks?(input: {
    chunks: Array<{
      file: File;
      startMs: number;
      endMs: number;
    }>;
    languageHint: string | null;
    durationSeconds?: number | null;
  }): Promise<TranscriptResult>;
}
