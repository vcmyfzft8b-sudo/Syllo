import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { CoverageCardKind, CoverageConcept, CoverageConceptType, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";

const UNIT_BATCH_SIZE = 5;
const UNIT_PLAN_CONCURRENCY = 2;

const plannerConceptSchema = z.object({
  conceptKey: z.string().min(3).max(80),
  conceptLabel: z.string().min(3).max(120),
  conceptType: z.string().min(3).max(40),
  studyValue: z.enum(["high", "medium", "low"]),
  recommendedCardCount: z.number().int().min(1).max(3),
  preferredCardStyle: z.string().min(3).max(40),
  supportingExcerpt: z.string().min(12),
});

const plannerUnitSchema = z.object({
  unitIndex: z.number().int().nonnegative(),
  sectionIndex: z.number().int().nonnegative(),
  sectionTitle: z.string().min(2).max(160),
  importance: z.enum(["high", "medium", "low"]),
  concepts: z.array(plannerConceptSchema),
});

const plannerBatchSchema = z.object({
  units: z.array(plannerUnitSchema).min(1).max(UNIT_BATCH_SIZE),
});

type PlannerUnitDraft = z.infer<typeof plannerUnitSchema>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function normalizeUnitText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isMetaStudyUnit(unit: SourceUnit) {
  const text = normalizeUnitText(unit.text);

  return (
    text.startsWith("cilji poglavja") ||
    text.includes("slika prikazuje") ||
    text.includes("primer poslovnega portala") ||
    (text.startsWith("omrežje z vozlišči") && text.includes("postaje povezane preko vozlišč"))
  );
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

function normalizeConceptType(value: string): CoverageConceptType {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "definition" ||
    normalized === "process" ||
    normalized === "comparison" ||
    normalized === "cause_effect" ||
    normalized === "example" ||
    normalized === "term" ||
    normalized === "sequence" ||
    normalized === "formula" ||
    normalized === "warning"
  ) {
    return normalized;
  }

  return fallbackConceptType(value);
}

function normalizeCardStyle(value: string, conceptType: CoverageConceptType): CoverageCardKind {
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

  if (normalized === "definition" || normalized === "term") {
    return "recall";
  }

  if (normalized === "process") {
    return "sequence";
  }

  if (normalized === "comparison") {
    return "compare";
  }

  if (normalized === "example") {
    return "apply";
  }

  return fallbackCardStyle(conceptType);
}

function buildFallbackConcept(unit: SourceUnit): CoverageConcept {
  const excerpt = unit.text.split(/(?<=[.!?])\s+/).find(Boolean) ?? unit.text.slice(0, 180);
  const conceptType = fallbackConceptType(unit.text);
  const maxRecommendedCardCount =
    unit.sourceType === "audio" && unit.wordCount >= 90 ? 3 : 2;

  return {
    conceptKey: `${unit.unitIndex}-${slugify(excerpt) || "core-idea"}`,
    conceptLabel: excerpt.slice(0, 100),
    conceptType,
    studyValue: unit.importance,
    recommendedCardCount: unit.importance === "high" ? maxRecommendedCardCount : 1,
    preferredCardStyle: fallbackCardStyle(conceptType),
    supportingExcerpt: excerpt.slice(0, 200),
  };
}

function normalizeUnitPlan(unit: SourceUnit, plan: PlannerUnitDraft | CoverageUnitPlan | undefined): CoverageUnitPlan {
  if (!plan) {
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
    concepts: plan.concepts.slice(0, 16).map((concept, index) => {
      const conceptType = normalizeConceptType(concept.conceptType);
      const maxRecommendedCardCount =
        unit.sourceType === "audio" && unit.wordCount >= 90 ? 3 : 2;

      return {
        ...concept,
        conceptType,
        preferredCardStyle: normalizeCardStyle(concept.preferredCardStyle, conceptType),
        conceptKey:
          concept.conceptKey || `${unit.unitIndex}-${slugify(concept.conceptLabel) || index}`,
        recommendedCardCount: Math.min(
          Math.max(concept.recommendedCardCount, 1),
          maxRecommendedCardCount,
        ),
      };
    }),
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
  const skippedPlans = new Map<number, CoverageUnitPlan>();
  const includedUnits = params.units.filter((unit) => {
    if (!isMetaStudyUnit(unit)) {
      return true;
    }

    skippedPlans.set(unit.unitIndex, {
      unitIndex: unit.unitIndex,
      sectionIndex: unit.sectionIndex,
      sectionTitle: unit.sectionTitle,
      importance: "low",
      concepts: [],
    });
    return false;
  });
  const batches: SourceUnit[][] = [];

  for (let index = 0; index < includedUnits.length; index += UNIT_BATCH_SIZE) {
    batches.push(includedUnits.slice(index, index + UNIT_BATCH_SIZE));
  }

  const plannedBatches = await mapWithConcurrency(batches, UNIT_PLAN_CONCURRENCY, async (batch) =>
    generateStructuredObject({
      schema: plannerBatchSchema,
      schemaName: "coverage_plan_batch",
      maxOutputTokens: Math.max(3200, batch.length * 760),
      instructions:
        "Create a study-worthy flashcard plan from the supplied source units. Preserve broad coverage of the material so a student can review the whole lecture through interactive study tools. Prefer atomic, testable facts over broad summaries. Good concepts are: acronym meanings, term definitions, protocol purposes, device roles, named examples, exact lists, step sequences, comparisons, warnings, and concrete numeric or structural facts. When a unit contains several distinct facts, split them into separate concepts rather than merging them. If a unit is mostly slide metadata, learning goals, repeated headings, or image/diagram narration such as 'the figure shows ...', return an empty concepts array for that unit. Do not create concepts for generic chapter goals, obvious captions, or paraphrases of the same point. Use high importance only for core exam-relevant facts. Default to one card per concept; recommend two cards when the source supports two distinct study angles such as recall plus process/comparison; recommend three cards only for dense source units with several distinct facts that deserve fuller review coverage.",
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
      const sourceUnit = params.units.find((unit) => unit.unitIndex === unitPlan.unitIndex);

      if (!sourceUnit) {
        continue;
      }

      planByUnit.set(unitPlan.unitIndex, normalizeUnitPlan(sourceUnit, unitPlan));
    }
  }

  for (const [unitIndex, plan] of skippedPlans) {
    planByUnit.set(unitIndex, plan);
  }

  return params.units.map((unit) => normalizeUnitPlan(unit, planByUnit.get(unit.unitIndex)));
}
