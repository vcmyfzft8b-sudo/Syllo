import "server-only";

import type { Json } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  responseTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiUsageContext = {
  stage?: string;
  userId?: string | null;
  lectureId?: string | null;
  metadata?: Record<string, unknown>;
};

type GeminiModelPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const GEMINI_MODEL_PRICES: Record<string, GeminiModelPrice> = {
  "gemini-3.1-flash-lite-preview": {
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.5,
  },
  "gemini-3-flash-preview": {
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: 3,
  },
  "gemini-2.5-flash-lite": {
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
  },
};

function toFiniteInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

function sanitizeJson(value: unknown): Json {
  if (value == null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, sanitizeJson(entryValue)]),
    ) as Json;
  }

  return String(value);
}

function normalizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function normalizeErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown; status?: unknown; name?: unknown };
  const code = candidate.code ?? candidate.status ?? candidate.name;

  if (code == null) {
    return null;
  }

  return String(code).slice(0, 80);
}

export function estimateGeminiCostUsd(
  model: string,
  usageMetadata: GeminiUsageMetadata | null | undefined,
) {
  const prices = GEMINI_MODEL_PRICES[model.toLowerCase().replace(/^models\//, "")];

  if (!prices || !usageMetadata) {
    return null;
  }

  const inputTokens = toFiniteInteger(usageMetadata.promptTokenCount) ?? 0;
  const candidateTokens =
    toFiniteInteger(usageMetadata.candidatesTokenCount) ??
    toFiniteInteger(usageMetadata.responseTokenCount) ??
    0;
  const thinkingTokens = toFiniteInteger(usageMetadata.thoughtsTokenCount) ?? 0;
  const outputTokens = candidateTokens + thinkingTokens;
  const cost =
    (inputTokens * prices.inputUsdPerMillion +
      outputTokens * prices.outputUsdPerMillion) /
    1_000_000;

  return Math.round(cost * 100_000_000) / 100_000_000;
}

export async function logGeminiUsageEvent(params: {
  model: string;
  stage: string;
  attemptIndex: number;
  success: boolean;
  usageMetadata?: GeminiUsageMetadata | null;
  context?: GeminiUsageContext;
  metadata?: Record<string, unknown>;
  error?: unknown;
}) {
  const usage = params.usageMetadata ?? null;
  const promptTokenCount = toFiniteInteger(usage?.promptTokenCount);
  const candidatesTokenCount =
    toFiniteInteger(usage?.candidatesTokenCount) ?? toFiniteInteger(usage?.responseTokenCount);
  const thoughtsTokenCount = toFiniteInteger(usage?.thoughtsTokenCount);
  const toolUsePromptTokenCount = toFiniteInteger(usage?.toolUsePromptTokenCount) ?? 0;
  const totalTokenCount =
    toFiniteInteger(usage?.totalTokenCount) ??
    (promptTokenCount == null && candidatesTokenCount == null && thoughtsTokenCount == null
      ? null
      : (promptTokenCount ?? 0) +
        (candidatesTokenCount ?? 0) +
        (thoughtsTokenCount ?? 0) +
        toolUsePromptTokenCount);

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("ai_usage_events").insert({
      user_id: params.context?.userId ?? null,
      lecture_id: params.context?.lectureId ?? null,
      provider: "gemini",
      model: params.model,
      stage: params.stage,
      attempt_index: params.attemptIndex,
      success: params.success,
      prompt_token_count: promptTokenCount,
      candidates_token_count: candidatesTokenCount,
      thoughts_token_count: thoughtsTokenCount,
      total_token_count: totalTokenCount,
      estimated_cost_usd: estimateGeminiCostUsd(params.model, usage),
      error_code: params.error ? normalizeErrorCode(params.error) : null,
      error_message: params.error ? normalizeErrorMessage(params.error) : null,
      metadata: sanitizeJson({
        ...(params.context?.metadata ?? {}),
        ...(params.metadata ?? {}),
      }),
    } as never);

    if (error) {
      console.warn("Failed to log Gemini usage event.", error.message);
    }
  } catch (error) {
    console.warn("Failed to log Gemini usage event.", error);
  }
}
