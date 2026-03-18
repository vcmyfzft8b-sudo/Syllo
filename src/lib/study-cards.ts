import "server-only";

import { z } from "zod";

import { citationSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import type { CoverageCardDraft, CoverageConcept, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";

const CARD_CONCURRENCY = 4;

const generatedCardSchema = z.object({
  front: z.string().min(6).max(140),
  back: z.string().min(12).max(260),
  hint: z.string().min(4).max(180).nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  citations: z.array(citationSchema).min(1).max(2),
  conceptKey: z.string().min(3).max(80),
  cardKind: z.enum(["recall", "explain", "compare", "apply", "sequence"]),
  coverageRank: z.number().int().min(0).max(10),
});

const generatedCardBatchSchema = z.object({
  flashcards: z.array(generatedCardSchema).min(1).max(18),
});

function normalizeCardText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCard(card: CoverageCardDraft): CoverageCardDraft {
  return {
    ...card,
    front: normalizeCardText(card.front),
    back: normalizeCardText(card.back),
    hint: card.hint ? normalizeCardText(card.hint) : null,
  };
}

function dedupeCards(cards: CoverageCardDraft[]) {
  const seen = new Set<string>();
  const output: CoverageCardDraft[] = [];

  for (const card of cards) {
    const key = `${card.conceptKey}::${card.cardKind}::${card.front.toLowerCase()}::${card.back.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
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
When a concept requests 2 or 3 cards, make them materially different from each other and cover distinct recall vs understanding angles from the same source concept.
Do not invent facts or examples.
Every card must cite 1 or 2 source units and the answer must be fully supported by those citations.
Use the provided conceptKey exactly.
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
        difficulty: card.difficulty,
        citations: card.citations,
        conceptKey: card.conceptKey,
        cardKind: card.cardKind,
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
