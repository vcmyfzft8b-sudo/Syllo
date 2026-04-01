import "server-only";

import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import { getServerEnv } from "@/lib/server-env";

export async function generateStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
}) {
  const env = getServerEnv();
  return generateStructuredObjectWithGemini({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: env.GEMINI_TEXT_MODEL,
    maxOutputTokens: params.maxOutputTokens,
  });
}
