import "server-only";

import { z } from "zod";

import { getPublicEnv } from "@/lib/public-env";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-transcribe-diarize"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  INTERNAL_JOB_SECRET: z.string().optional(),
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SITE_URL: getPublicEnv().siteUrl,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
    OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL,
    OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
  });
}

export function hasServerAiEnv() {
  return Boolean(process.env.OPENAI_API_KEY);
}
