import "server-only";

import { transcribeAudioWithGemini } from "@/lib/ai/gemini";
import type { TranscriptionProvider } from "@/lib/transcription/types";

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
  }) {
    return transcribeAudioWithGemini(input);
  }
}
