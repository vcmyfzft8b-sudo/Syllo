import "server-only";

import { getAiProvider } from "@/lib/server-env";
import { OpenAiTranscriptionProvider } from "@/lib/transcription/openai";
import { GeminiTranscriptionProvider } from "@/lib/transcription/gemini";
import type { TranscriptionProvider } from "@/lib/transcription/types";

const openAiProvider = new OpenAiTranscriptionProvider();
const geminiProvider = new GeminiTranscriptionProvider();

export function getTranscriptionProvider(): TranscriptionProvider {
  return getAiProvider() === "gemini" ? geminiProvider : openAiProvider;
}
