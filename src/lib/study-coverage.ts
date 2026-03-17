import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { CoverageCardKind, CoverageConcept, CoverageConceptType, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";

const UNIT_BATCH_SIZE = 5;
const UNIT_PLAN_CONCURRENCY = 4;

const plannerConceptSchema = z.object({
  conceptKey: z.string().min(3).max(80),
  conceptLabel: z.string().min(3).max(120),
  conceptType: z.enum([
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
  recommendedCardCount: z.number().int().min(1).max(3),
  preferredCardStyle: z.enum(["recall", "explain", "compare", "apply", "sequence"]),
  supportingExcerpt: z.string().min(12).max(220),
});

const plannerUnitSchema = z.object({
  unitIndex: z.number().int().nonnegative(),
  sectionIndex: z.number().int().nonnegative(),
  sectionTitle: z.string().min(2).max(160),
  importance: z.enum(["high", "medium", "low"]),
  concepts: z.array(plannerConceptSchema).min(1).max(8),
});

const plannerBatchSchema = z.object({
  units: z.array(plannerUnitSchema).min(1).max(UNIT_BATCH_SIZE),
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function fallbackConceptType(text: string): CoverageConceptType {
  if (/\b(compare|versus|vs\.?|difference)\b/i.test(text)) {
    return "comparison";
  }

  if (/\b(step|first|next|then|finally|process)\b/i.test(text)) {
    return "sequence";
  }

  if (/\bcauses?|results? in|leads? to|because\b/i.test(text)) {
    return "cause_effect";
  }

  return "definition";
}

function fallbackCardStyle(type: CoverageConceptType): CoverageCardKind {
  if (type === "comparison") {
    return "compare";
  }

  if (type === "example") {
    return "apply";
  }

  if (type === "sequence" || type === "process") {
    return "sequence";
  }

  if (type === "cause_effect") {
    return "explain";
  }

  return "recall";
}

function buildFallbackConcept(unit: SourceUnit): CoverageConcept {
  const excerpt = unit.text.split(/(?<=[.!?])\s+/).find(Boolean) ?? unit.text.slice(0, 180);
  const conceptType = fallbackConceptType(unit.text);

  return {
    conceptKey: `${unit.unitIndex}-${slugify(excerpt) || "core-idea"}`,
    conceptLabel: excerpt.slice(0, 100),
    conceptType,
    studyValue: unit.importance,
    recommendedCardCount: unit.importance === "high" ? 3 : unit.importance === "medium" ? 2 : 1,
    preferredCardStyle: fallbackCardStyle(conceptType),
    supportingExcerpt: excerpt.slice(0, 200),
  };
}

function normalizeUnitPlan(unit: SourceUnit, plan: CoverageUnitPlan | undefined): CoverageUnitPlan {
  if (!plan || plan.concepts.length === 0) {
    return {
      unitIndex: unit.unitIndex,
      sectionIndex: unit.sectionIndex,
      sectionTitle: unit.sectionTitle,
      importance: unit.importance,
      concepts: [buildFallbackConcept(unit)],
    };
  }

  return {
    unitIndex: unit.unitIndex,
    sectionIndex: unit.sectionIndex,
    sectionTitle: plan.sectionTitle || unit.sectionTitle,
    importance: plan.importance || unit.importance,
    concepts: plan.concepts.map((concept, index) => ({
      ...concept,
      conceptKey: concept.conceptKey || `${unit.unitIndex}-${slugify(concept.conceptLabel) || index}`,
      recommendedCardCount: Math.min(Math.max(concept.recommendedCardCount, 1), 3),
    })),
  };
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

export async function createCoveragePlan(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  units: SourceUnit[];
}) {
  const batches: SourceUnit[][] = [];

  for (let index = 0; index < params.units.length; index += UNIT_BATCH_SIZE) {
    batches.push(params.units.slice(index, index + UNIT_BATCH_SIZE));
  }

  const plannedBatches = await mapWithConcurrency(batches, UNIT_PLAN_CONCURRENCY, async (batch) =>
    generateStructuredObject({
      schema: plannerBatchSchema,
      schemaName: "coverage_plan_batch",
      maxOutputTokens: Math.max(3200, batch.length * 760),
      instructions:
        "Create a coverage-first flashcard plan from the supplied source units. Do not summarize away details. Every unit with meaningful content must produce at least one study-worthy concept, and dense units should produce several concepts. Preserve technical terms, steps, examples, definitions, comparisons, formulas, caveats, lists, and warnings that a student would need to know after reading the source. Favor over-coverage rather than under-coverage. Ignore obvious boilerplate or repeated headers only when they add no study value. Use high importance when the unit introduces a core definition, major mechanism, key process, or exam-relevant detail. When a unit contains multiple explicit facts or sub-points, split them into separate concepts rather than collapsing them.",
      input: JSON.stringify(
        {
          title: params.title,
          summary: params.summary,
          keyTopics: params.keyTopics,
          units: batch.map((unit) => ({
            unitIndex: unit.unitIndex,
            sectionIndex: unit.sectionIndex,
            sectionTitle: unit.sectionTitle,
            locatorLabel: unit.locatorLabel,
            sourceType: unit.sourceType,
            text: unit.text,
          })),
        },
        null,
        2,
      ),
    }),
  );

  const planByUnit = new Map<number, CoverageUnitPlan>();

  for (const batch of plannedBatches) {
    for (const unitPlan of batch.units) {
      planByUnit.set(unitPlan.unitIndex, unitPlan);
    }
  }

  return params.units.map((unit) => normalizeUnitPlan(unit, planByUnit.get(unit.unitIndex)));
}
