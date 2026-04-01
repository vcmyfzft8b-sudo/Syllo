import "server-only";

import { createGeminiEmbeddings } from "@/lib/ai/gemini";

export async function createEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  return createGeminiEmbeddings(texts);
}
