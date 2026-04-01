import "server-only";

import { GoogleGenAI, createPartFromUri } from "@google/genai";
import { z } from "zod";

import { isRetryableAiError } from "@/lib/ai/errors";
import { requireGeminiEnv } from "@/lib/server-env";

const GEMINI_GENERATION_MAX_ATTEMPTS = 4;
const GEMINI_EMBEDDING_DIMENSION = 1536;
const GEMINI_GENERATION_TIMEOUT_MS = 90_000;
const GEMINI_RETRY_BASE_DELAY_MS = 1_500;

let geminiClient: GoogleGenAI | undefined;

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function extractJsonPayload(value: string) {
  const stripped = stripCodeFences(value);
  const objectStart = stripped.indexOf("{");
  const arrayStart = stripped.indexOf("[");
  const candidateStarts = [objectStart, arrayStart].filter((index) => index >= 0);

  if (candidateStarts.length === 0) {
    return stripped;
  }

  const start = Math.min(...candidateStarts);
  const openingChar = stripped[start];
  const closingChar = openingChar === "[" ? "]" : "}";
  const end = stripped.lastIndexOf(closingChar);

  if (end <= start) {
    return stripped.slice(start).trim();
  }

  return stripped.slice(start, end + 1).trim();
}

function parseStructuredText<TSchema extends z.ZodTypeAny>(schema: TSchema, text: string) {
  return schema.parse(JSON.parse(extractJsonPayload(text)));
}

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isGeminiSchemaTooComplexError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();

  return (
    message.includes("too many states for serving") ||
    (message.includes("invalid_argument") && message.includes("specified schema"))
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGeminiClient() {
  if (!geminiClient) {
    const env = requireGeminiEnv();
    geminiClient = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
    });
  }

  return geminiClient;
}

export async function generateStructuredObjectWithGemini<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  model: string;
  maxOutputTokens?: number;
}) {
  const ai = getGeminiClient();
  let lastError: unknown = null;
  let useResponseSchema = true;
  const responseSchema = z.toJSONSchema(params.schema);

  for (let attempt = 0; attempt < GEMINI_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const retryInstruction =
      attempt === 0 || !lastError
        ? ""
        : `\n\nPrevious attempt failed because the JSON was invalid: ${toErrorMessage(
            lastError,
          )}. Return exactly one valid JSON object matching the schema.`;

    try {
      const maxOutputTokens = params.maxOutputTokens
        ? Math.round(params.maxOutputTokens * (attempt === 0 ? 1 : 1 + attempt * 0.4))
        : undefined;
      const response = await withTimeout(
        ai.models.generateContent({
          model: params.model,
          contents: `${params.instructions}${retryInstruction}

Return exactly one JSON object that matches this JSON schema:
${JSON.stringify(responseSchema)}

Source input:
${params.input}`,
          config: {
            responseMimeType: "application/json",
            ...(useResponseSchema ? { responseSchema } : {}),
            maxOutputTokens,
          },
        }),
        GEMINI_GENERATION_TIMEOUT_MS,
        "Gemini structured generation",
      );

      const outputText = stripCodeFences(response.text ?? "");

      if (!outputText) {
        throw new Error("Model returned empty structured output.");
      }

      return parseStructuredText(params.schema, outputText);
    } catch (error) {
      if (useResponseSchema && isGeminiSchemaTooComplexError(error)) {
        useResponseSchema = false;
      }

      lastError = error;

      if (attempt < GEMINI_GENERATION_MAX_ATTEMPTS - 1 && isRetryableAiError(error)) {
        await sleep(GEMINI_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(toErrorMessage(lastError));
}

export async function generateStructuredObjectWithGeminiFile<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  file: File;
  model: string;
  maxOutputTokens?: number;
}) {
  const ai = getGeminiClient();
  const tempPath = `/tmp/${crypto.randomUUID()}-${params.file.name || "document.bin"}`;
  const bytes = Buffer.from(await params.file.arrayBuffer());
  const fs = await import("node:fs/promises");
  let uploadedFileName: string | null = null;
  let lastError: unknown = null;
  let useResponseSchema = true;
  const responseSchema = z.toJSONSchema(params.schema);

  await fs.writeFile(tempPath, bytes);

  try {
    const uploaded = await ai.files.upload({
      file: tempPath,
      config: {
        mimeType: params.file.type || "application/octet-stream",
      },
    });

    uploadedFileName = uploaded.name ?? null;

    for (let attempt = 0; attempt < GEMINI_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      const retryInstruction =
        attempt === 0 || !lastError
          ? ""
          : `\n\nPrevious attempt failed because the JSON was invalid: ${toErrorMessage(
              lastError,
            )}. Return exactly one valid JSON object matching the schema.`;

      try {
        const maxOutputTokens = params.maxOutputTokens
          ? Math.round(params.maxOutputTokens * (attempt === 0 ? 1 : 1 + attempt * 0.4))
          : undefined;
        const response = await withTimeout(
          ai.models.generateContent({
            model: params.model,
            contents: [
              `${params.instructions}${retryInstruction}

Return exactly one JSON object that matches this JSON schema:
${JSON.stringify(responseSchema)}`,
              createPartFromUri(
                uploaded.uri ?? "",
                uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
              ),
            ],
            config: {
              responseMimeType: "application/json",
              ...(useResponseSchema ? { responseSchema } : {}),
              maxOutputTokens,
            },
          }),
          GEMINI_GENERATION_TIMEOUT_MS,
          "Gemini document extraction",
        );

        const outputText = stripCodeFences(response.text ?? "");

        if (!outputText) {
          throw new Error("Model returned empty structured output.");
        }

        return parseStructuredText(params.schema, outputText);
      } catch (error) {
        if (useResponseSchema && isGeminiSchemaTooComplexError(error)) {
          useResponseSchema = false;
        }

        lastError = error;

        if (attempt < GEMINI_GENERATION_MAX_ATTEMPTS - 1 && isRetryableAiError(error)) {
          await sleep(GEMINI_RETRY_BASE_DELAY_MS * (attempt + 1));
        }
      }
    }

    throw new Error(toErrorMessage(lastError));
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => null);

    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => null);
    }
  }
}

export async function createGeminiEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const ai = getGeminiClient();
  const env = requireGeminiEnv();
  const response = await ai.models.embedContent({
    model: env.GEMINI_EMBEDDING_MODEL,
    contents: texts,
    config: {
      outputDimensionality: GEMINI_EMBEDDING_DIMENSION,
    },
  });

  return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
}
