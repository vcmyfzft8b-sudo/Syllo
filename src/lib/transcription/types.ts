import type { TranscriptResult } from "@/lib/types";

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
