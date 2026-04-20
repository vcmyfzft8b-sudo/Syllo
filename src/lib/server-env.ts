import "server-only";

import { z } from "zod";

import { getPublicEnv } from "@/lib/public-env";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_OCR_MODEL: z.string().default("gemini-3.1-flash-lite-preview"),
  GEMINI_OCR_RESCUE_MODEL: z.string().default("gemini-3-flash-preview"),
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
    NEXT_PUBLIC_SITE_URL: getPublicEnv().siteUrl,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_TEXT_MODEL: process.env.GEMINI_TEXT_MODEL,
    GEMINI_OCR_MODEL: process.env.GEMINI_OCR_MODEL,
    GEMINI_OCR_RESCUE_MODEL: process.env.GEMINI_OCR_RESCUE_MODEL,
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
  return Boolean(process.env.GEMINI_API_KEY || process.env.SONIOX_API_KEY);
}

export function getAiProvider() {
  return "gemini" as const;
}

export function getTranscriptionProviderName() {
  return "soniox" as const;
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
