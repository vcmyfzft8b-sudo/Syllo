import "server-only";

import { createGeminiEmbeddings } from "@/lib/ai/gemini";
import { getOpenAiClient } from "@/lib/ai/openai";
import { getAiProvider, getServerEnv } from "@/lib/server-env";

export async function createEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const env = getServerEnv();

  if (getAiProvider() === "gemini") {
    return createGeminiEmbeddings(texts);
  }

  const openai = getOpenAiClient();
  const response = await openai.embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}
