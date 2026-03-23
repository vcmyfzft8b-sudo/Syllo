import "server-only";

import { z } from "zod";

import { citationSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import type {
  CoverageCardDraft,
  CoverageCardKind,
  CoverageConcept,
  CoverageUnitPlan,
  SourceUnit,
} from "@/lib/study-models";
import type { FlashcardDifficulty } from "@/lib/database.types";

const CARD_CONCURRENCY = 4;

const generatedCardSchema = z.object({
  front: z.string().min(6).max(140),
  back: z.string().min(1).max(420),
  hint: z.string().min(4).max(180).nullable(),
  difficulty: z.string().min(3).max(40),
  citations: z.array(citationSchema).min(1).max(2),
  conceptKey: z.string().min(3).max(80),
  cardKind: z.string().min(3).max(40),
  coverageRank: z.number().int().min(0).max(10),
});

const generatedCardBatchSchema = z.object({
  flashcards: z.array(generatedCardSchema).min(1).max(18),
});

function normalizeCardText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSimilarityText(value: string) {
  return normalizeCardText(value)
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9ščžćđ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(normalizeSimilarityText(left).split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeSimilarityText(right).split(" ").filter((token) => token.length > 2));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function normalizeCard(card: CoverageCardDraft): CoverageCardDraft {
  const normalizedBack = normalizeCardText(card.back);

  return {
    ...card,
    front: normalizeCardText(card.front),
    back: (normalizedBack.length >= 12 ? normalizedBack : `${normalizedBack}.`).slice(0, 260).trim(),
    hint: card.hint ? normalizeCardText(card.hint) : null,
  };
}

function normalizeDifficulty(value: string): FlashcardDifficulty {
  const normalized = value.trim().toLowerCase();

  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }

  if (normalized === "simple" || normalized === "basic" || normalized === "lahko") {
    return "easy";
  }

  if (normalized === "advanced" || normalized === "challenging" || normalized === "tezko" || normalized === "tezko.") {
    return "hard";
  }

  return "medium";
}

function normalizeCardKind(value: string, fallback: CoverageCardKind): CoverageCardKind {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "recall" ||
    normalized === "explain" ||
    normalized === "compare" ||
    normalized === "apply" ||
    normalized === "sequence"
  ) {
    return normalized;
  }

  if (normalized === "definition" || normalized === "term" || normalized === "formula") {
    return "recall";
  }

  if (
    normalized === "process" ||
    normalized === "steps" ||
    normalized === "ordered" ||
    normalized === "order"
  ) {
    return "sequence";
  }

  if (normalized === "comparison" || normalized === "contrast") {
    return "compare";
  }

  if (
    normalized === "example" ||
    normalized === "application" ||
    normalized === "practice"
  ) {
    return "apply";
  }

  if (
    normalized === "why" ||
    normalized === "how" ||
    normalized === "cause_effect" ||
    normalized === "cause-effect"
  ) {
    return "explain";
  }

  return fallback;
}

function dedupeCards(cards: CoverageCardDraft[]) {
  const output: CoverageCardDraft[] = [];

  for (const card of cards) {
    const exactKey = `${card.conceptKey}::${card.cardKind}::${card.front.toLowerCase()}::${card.back.toLowerCase()}`;
    const nearDuplicate = output.some((existing) => {
      if (existing.conceptKey !== card.conceptKey) {
        return false;
      }

      if (existing.cardKind === card.cardKind) {
        return true;
      }

      const backOverlap = tokenOverlap(existing.back, card.back);
      const frontOverlap = tokenOverlap(existing.front, card.front);
      return backOverlap >= 0.82 || frontOverlap >= 0.9;
    });

    if (nearDuplicate || output.some((existing) => `${existing.conceptKey}::${existing.cardKind}::${existing.front.toLowerCase()}::${existing.back.toLowerCase()}` === exactKey)) {
      continue;
    }

    output.push(card);
  }

  return output;
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);

  return results;
}

async function generateCardsForUnit(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  unit: SourceUnit;
  plan: CoverageUnitPlan;
  contextUnits: SourceUnit[];
  concepts: CoverageConcept[];
  outputLanguage?: string | null;
  repairOnly?: boolean;
}) {
  const targetCount = params.concepts.reduce(
    (total, concept) => total + concept.recommendedCardCount,
    0,
  );
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const conceptFallbackCardKind = new Map(
    params.concepts.map((concept) => [concept.conceptKey, concept.preferredCardStyle]),
  );

  const batch = await generateStructuredObject({
    schema: generatedCardBatchSchema,
    schemaName: `coverage_cards_unit_${params.unit.unitIndex}`,
    maxOutputTokens: Math.max(2600, targetCount * 560),
    instructions:
      `${languageInstruction}
${params.repairOnly ? "Repair missing concept coverage." : "Generate source-grounded study flashcards."}
Use only the supplied source units.
Cover every requested concept explicitly.
Produce mixed study cards:
- recall cards for essential terms, definitions, names, dates, and formulas
- explain cards for how and why
- compare cards for contrasts
- sequence cards for steps and ordered processes
- apply cards only when the source includes an example or practical case
Do not collapse different concepts into one card.
When a concept requests 2 cards, make them materially different from each other and cover distinct recall vs understanding angles from the same source concept.
Do not invent facts or examples.
Every card must cite 1 or 2 source units and the answer must be fully supported by those citations.
Use the provided conceptKey exactly.
Prefer concise, exam-style cards over broad explanatory paraphrases.
Prefer direct definition, acronym, device-role, protocol-purpose, and exact-list cards.
Only use broad "zakaj" or "kako" explanation cards when the source clearly teaches a mechanism or ordered process that matters to understand, not just to recall.
For acronyms, named protocols, named devices, or named services, prefer direct cards such as "Kaj pomeni kratica X?" or "Kaj je vloga X?".
For list facts, ask for the complete set only when the set itself matters.
Do not create cards about generic chapter goals, obvious figure captions, or "what does the picture show" unless the figure adds a distinct fact not stated elsewhere.
Backs should usually be one short sentence or one short list item unless a full sequence is required.
Keep fronts concise and backs concise enough to review quickly.`,
    input: JSON.stringify(
      {
        title: params.title,
        summary: params.summary,
        keyTopics: params.keyTopics,
        repairOnly: Boolean(params.repairOnly),
        unit: {
          unitIndex: params.unit.unitIndex,
          sectionTitle: params.unit.sectionTitle,
          locatorLabel: params.unit.locatorLabel,
          sourceType: params.unit.sourceType,
          text: params.unit.text,
        },
        concepts: params.concepts,
        contextUnits: params.contextUnits.map((unit) => ({
          unitIndex: unit.unitIndex,
          locatorLabel: unit.locatorLabel,
          text: unit.text,
        })),
      },
      null,
      2,
    ),
  });

  return dedupeCards(
    batch.flashcards.map((card) =>
      normalizeCard({
        front: card.front,
        back: card.back,
        hint: card.hint,
        difficulty: normalizeDifficulty(card.difficulty),
        citations: card.citations,
        conceptKey: card.conceptKey,
        cardKind: normalizeCardKind(
          card.cardKind,
          conceptFallbackCardKind.get(card.conceptKey) ?? "recall",
        ),
        sourceUnitIdx: params.unit.unitIndex,
        sourceType: params.unit.sourceType,
        sourceLocator: params.unit.locatorLabel,
        coverageRank: card.coverageRank,
      }),
    ),
  );
}

export async function generateCoverageCards(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  units: SourceUnit[];
  plans: CoverageUnitPlan[];
  outputLanguage?: string | null;
}) {
  const planByUnit = new Map(params.plans.map((plan) => [plan.unitIndex, plan]));

  const unitCards = await mapWithConcurrency(params.units, CARD_CONCURRENCY, async (unit, index) => {
    const plan = planByUnit.get(unit.unitIndex);
    if (!plan) {
      return [];
    }

    return generateCardsForUnit({
      title: params.title,
      summary: params.summary,
      keyTopics: params.keyTopics,
      unit,
      plan,
      concepts: plan.concepts,
      contextUnits: params.units.slice(Math.max(0, index - 1), Math.min(params.units.length, index + 2)),
      outputLanguage: params.outputLanguage,
    });
  });

  return unitCards.flat();
}

export async function repairCoverageCards(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  units: SourceUnit[];
  plans: CoverageUnitPlan[];
  missingConceptsByUnit: Map<number, CoverageConcept[]>;
  outputLanguage?: string | null;
}) {
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const planByUnit = new Map(params.plans.map((plan) => [plan.unitIndex, plan]));
  const repairTargets = [...params.missingConceptsByUnit.entries()];

  const repairedCards = await mapWithConcurrency(repairTargets, CARD_CONCURRENCY, async ([unitIndex, concepts]) => {
    const unit = unitByIndex.get(unitIndex);
    const plan = planByUnit.get(unitIndex);

    if (!unit || !plan || concepts.length === 0) {
      return [];
    }

    return generateCardsForUnit({
      title: params.title,
      summary: params.summary,
      keyTopics: params.keyTopics,
      unit,
      plan,
      concepts,
      contextUnits: params.units.slice(Math.max(0, unitIndex - 1), Math.min(params.units.length, unitIndex + 2)),
      outputLanguage: params.outputLanguage,
      repairOnly: true,
    });
  });

  return repairedCards.flat();
}
