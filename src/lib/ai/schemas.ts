import { z } from "zod";

export const citationSchema = z.object({
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  quote: z.string().min(3),
});

export const chunkSummarySchema = z.object({
  heading: z.string().min(3),
  summary: z.string().min(20),
  bulletPoints: z.array(z.string().min(6)).min(3).max(8),
  terminology: z.array(z.string().min(2)).min(2).max(8),
});

export const noteArtifactSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(20).max(700),
  keyTopics: z.array(z.string().min(2)).min(5).max(8),
  structuredNotesMd: z.string().min(100),
});

export const chatAnswerSchema = z.object({
  answer: z.string().min(10),
  citations: z.array(citationSchema).max(4),
});

export const flashcardDeckSchema = z.object({
  flashcards: z.array(
    z.object({
      front: z.string().min(8).max(140),
      back: z.string().min(30).max(420),
      hint: z.string().min(6).max(180).nullable(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      citations: z.array(citationSchema).min(1).max(2),
    }),
  ).length(12),
});
