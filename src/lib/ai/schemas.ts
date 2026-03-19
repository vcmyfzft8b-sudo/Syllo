import { z } from "zod";

export const citationSchema = z.object({
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  quote: z.string().min(3),
});

export const chunkSummarySchema = z.object({
  heading: z.string().min(3),
  summary: z.string().min(60).max(700),
  bulletPoints: z.array(z.string().min(12)).min(5).max(12),
  supportingDetails: z.array(z.string().min(12)).min(2).max(8),
  examples: z.array(z.string().min(12)).max(4),
  terminology: z.array(z.string().min(2)).min(3).max(10),
});

export const noteStudyPointSchema = z.object({
  pointKey: z.string().min(3).max(80),
  text: z.string().min(18).max(320),
  pointType: z.enum([
    "definition",
    "process",
    "comparison",
    "cause_effect",
    "example",
    "term",
    "sequence",
    "formula",
    "warning",
  ]),
  studyValue: z.enum(["high", "medium", "low"]),
});

export const noteStudySectionSchema = z.object({
  title: z.string().min(3).max(160),
  summary: z.string().min(20).max(400),
  points: z.array(noteStudyPointSchema).min(1).max(10),
});

export const noteStudyOutlineSchema = z.array(noteStudySectionSchema).min(1).max(18);

export const noteArtifactSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40).max(1200),
  keyTopics: z.array(z.string().min(2)).min(6).max(14),
  structuredNotesMd: z.string().min(300),
  studyOutline: noteStudyOutlineSchema,
});

export const chatAnswerSchema = z.object({
  answer: z.string().min(10),
  citations: z.array(citationSchema).max(4),
});

export const flashcardSchema = z.object({
  front: z.string().min(6).max(120),
  back: z.string().min(12).max(220),
  hint: z.string().min(6).max(180).nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  citations: z.array(citationSchema).min(1).max(2),
});

export function createFlashcardDeckSchema(cardCount: number) {
  return z.object({
    flashcards: z.array(flashcardSchema).length(cardCount),
  });
}
