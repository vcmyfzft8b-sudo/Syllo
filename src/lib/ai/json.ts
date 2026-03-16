import "server-only";

import type { ResponseInput } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { getOpenAiClient } from "@/lib/ai/openai";
import { getServerEnv } from "@/lib/server-env";

export async function generateStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  schemaName?: string;
  instructions: string;
  input: string | ResponseInput;
  maxOutputTokens?: number;
}) {
  const env = getServerEnv();
  const openai = getOpenAiClient();

  const response = await openai.responses.parse({
    model: env.OPENAI_TEXT_MODEL,
    instructions: params.instructions,
    input: params.input,
    max_output_tokens: params.maxOutputTokens,
    text: {
      format: zodTextFormat(
        params.schema,
        params.schemaName ?? "structured_output",
      ),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Model did not return structured output.");
  }

  return params.schema.parse(response.output_parsed);
}
