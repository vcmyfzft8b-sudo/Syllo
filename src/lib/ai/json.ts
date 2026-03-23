import "server-only";

import type { ResponseInput } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import { getOpenAiClient } from "@/lib/ai/openai";
import { getAiProvider, getServerEnv } from "@/lib/server-env";

const STRUCTURED_OUTPUT_MAX_ATTEMPTS = 3;

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function getResponseText(response: { output_text?: string }) {
  return typeof response.output_text === "string" ? response.output_text.trim() : "";
}

function parseStructuredText<TSchema extends z.ZodTypeAny>(schema: TSchema, text: string) {
  return schema.parse(JSON.parse(stripCodeFences(text)));
}

function describeStructuredOutputError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown structured output error.";
}

export async function generateStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  schemaName?: string;
  instructions: string;
  input: string | ResponseInput;
  maxOutputTokens?: number;
}) {
  const provider = getAiProvider();
  const env = getServerEnv();
  const baseMaxOutputTokens = params.maxOutputTokens;
  let lastError: unknown = null;

  if (provider === "gemini") {
    if (typeof params.input !== "string") {
      throw new Error("Gemini structured generation currently expects string input.");
    }

    return generateStructuredObjectWithGemini({
      schema: params.schema,
      instructions: params.instructions,
      input: params.input,
      model: env.GEMINI_TEXT_MODEL,
      maxOutputTokens: params.maxOutputTokens,
    });
  }

  const openai = getOpenAiClient();

  for (let attempt = 0; attempt < STRUCTURED_OUTPUT_MAX_ATTEMPTS; attempt += 1) {
    const retryInstruction =
      attempt === 0 || !lastError
        ? ""
        : `\n\nPrevious attempt failed because the structured JSON was invalid: ${describeStructuredOutputError(
            lastError,
          )}. Return exactly one valid JSON value that matches the schema. Do not use markdown fences, commentary, ellipses, or trailing text. Escape all quotes and line breaks inside JSON strings correctly.`;

    const maxOutputTokens = baseMaxOutputTokens
      ? Math.round(baseMaxOutputTokens * (attempt === 0 ? 1 : 1 + attempt * 0.35))
      : undefined;

    const response = await openai.responses.create({
      model: env.OPENAI_TEXT_MODEL,
      instructions: `${params.instructions}${retryInstruction}`,
      input: params.input,
      max_output_tokens: maxOutputTokens,
      text: {
        format: zodTextFormat(
          params.schema,
          params.schemaName ?? "structured_output",
        ),
      },
    });

    const outputText = getResponseText(response);

    if (!outputText) {
      lastError = new Error("Model returned empty structured output.");
      continue;
    }

    try {
      return parseStructuredText(params.schema, outputText);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(describeStructuredOutputError(lastError));
}
