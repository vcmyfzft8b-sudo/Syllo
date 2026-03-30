import "server-only";

import { z } from "zod";

import { getPublicEnv } from "@/lib/public-env";

const aiProviderSchema = z.enum(["openai", "gemini"]);
const transcriptionProviderSchema = z.enum(["openai", "gemini", "soniox"]);

const serverEnvSchema = z.object({
  AI_PROVIDER: aiProviderSchema.default("openai"),
  TRANSCRIPTION_PROVIDER: transcriptionProviderSchema.optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-transcribe-diarize"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_TRANSCRIPTION_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  SONIOX_API_KEY: z.string().optional(),
  SONIOX_MODEL: z.string().default("stt-async-v4"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  INTERNAL_JOB_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_WEEKLY: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_YEARLY: z.string().optional(),
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    AI_PROVIDER: process.env.AI_PROVIDER,
    TRANSCRIPTION_PROVIDER: process.env.TRANSCRIPTION_PROVIDER,
    NEXT_PUBLIC_SITE_URL: getPublicEnv().siteUrl,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
    OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL,
    OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_TEXT_MODEL: process.env.GEMINI_TEXT_MODEL,
    GEMINI_TRANSCRIPTION_MODEL: process.env.GEMINI_TRANSCRIPTION_MODEL,
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
    SONIOX_API_KEY: process.env.SONIOX_API_KEY,
    SONIOX_MODEL: process.env.SONIOX_MODEL,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET?.trim(),
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY?.trim(),
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET?.trim(),
    STRIPE_PRICE_WEEKLY: process.env.STRIPE_PRICE_WEEKLY?.trim(),
    STRIPE_PRICE_MONTHLY: process.env.STRIPE_PRICE_MONTHLY?.trim(),
    STRIPE_PRICE_YEARLY: process.env.STRIPE_PRICE_YEARLY?.trim(),
  });
}

export function hasServerAiEnv() {
  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.SONIOX_API_KEY,
  );
}

export function getAiProvider() {
  return getServerEnv().AI_PROVIDER;
}

export function getTranscriptionProviderName() {
  const env = getServerEnv();
  return env.TRANSCRIPTION_PROVIDER ?? env.AI_PROVIDER;
}

export function requireOpenAiEnv() {
  const env = getServerEnv();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  return env;
}

export function requireGeminiEnv() {
  const env = getServerEnv();

  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  return env;
}

export function requireSonioxEnv() {
  const env = getServerEnv();

  if (!env.SONIOX_API_KEY) {
    throw new Error("SONIOX_API_KEY is not configured.");
  }

  return env;
}
