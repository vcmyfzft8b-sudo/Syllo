import "server-only";

import { GoogleGenAI, createPartFromUri } from "@google/genai";
import { z } from "zod";

import { requireGeminiEnv } from "@/lib/server-env";
import type { TranscriptResult } from "@/lib/types";

const GEMINI_GENERATION_MAX_ATTEMPTS = 3;
const GEMINI_EMBEDDING_DIMENSION = 1536;

let geminiClient: GoogleGenAI | undefined;

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

  for (let attempt = 0; attempt < GEMINI_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const retryInstruction =
      attempt === 0 || !lastError
        ? ""
        : `\n\nPrevious attempt failed because the JSON was invalid: ${toErrorMessage(
            lastError,
          )}. Return exactly one valid JSON object matching the schema.`;

    try {
      const response = await ai.models.generateContent({
        model: params.model,
        contents: `${params.instructions}${retryInstruction}\n\n${params.input}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: z.toJSONSchema(params.schema),
          maxOutputTokens: params.maxOutputTokens,
        },
      });

      const outputText = stripCodeFences(response.text ?? "");

      if (!outputText) {
        throw new Error("Model returned empty structured output.");
      }

      return params.schema.parse(JSON.parse(outputText));
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(toErrorMessage(lastError));
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

const geminiTranscriptSegmentSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  speakerLabel: z.string().min(1).nullable(),
  text: z.string().min(1),
});

const geminiTranscriptSchema = z.object({
  segments: z.array(geminiTranscriptSegmentSchema).min(1),
});

export async function transcribeAudioWithGemini(input: {
  file: File;
  languageHint: string | null;
  durationSeconds?: number | null;
}): Promise<TranscriptResult> {
  const ai = getGeminiClient();
  const env = requireGeminiEnv();
  const tempPath = `/tmp/${crypto.randomUUID()}-${input.file.name || "lecture.bin"}`;
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fs = await import("node:fs/promises");

  await fs.writeFile(tempPath, bytes);

  let uploadedFileName: string | null = null;

  try {
    const uploaded = await ai.files.upload({
      file: tempPath,
      config: {
        mimeType: input.file.type || "audio/mp4",
      },
    });

    uploadedFileName = uploaded.name ?? null;

    const response = await ai.models.generateContent({
      model: env.GEMINI_TRANSCRIPTION_MODEL,
      contents: [
        `Transcribe this lecture audio in ${input.languageHint ?? "the original language"}.
Return a complete transcript as timestamped sequential segments.
Timestamps must reflect the real audio timeline in milliseconds.
Do not summarize. Do not omit the ending. Merge tiny fragments into readable segments.
Every segment must include startMs, endMs, speakerLabel (or null), and text.
Produce only valid JSON that matches the requested schema.`,
        createPartFromUri(
          uploaded.uri ?? "",
          uploaded.mimeType ?? input.file.type ?? "audio/mp4",
        ),
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: z.toJSONSchema(geminiTranscriptSchema),
        maxOutputTokens: 8192,
      },
    });

    const transcript = geminiTranscriptSchema.parse(
      JSON.parse(stripCodeFences(response.text ?? "")),
    );

    const segments = transcript.segments
      .map((segment, index) => ({
        idx: index,
        startMs: segment.startMs,
        endMs: Math.max(segment.endMs, segment.startMs),
        speakerLabel: segment.speakerLabel,
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text.length > 0);

    const lastEndMs = segments.reduce(
      (maxEndMs, segment) => Math.max(maxEndMs, segment.endMs),
      0,
    );

    return {
      text: segments.map((segment) => segment.text).join(" ").trim(),
      durationSeconds: Math.max(
        Math.round(lastEndMs / 1000),
        Math.round(input.durationSeconds ?? 0),
      ),
      segments,
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => null);

    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => null);
    }
  }
}
