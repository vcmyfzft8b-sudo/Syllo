import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { CoverageCardKind, CoverageConcept, CoverageConceptType, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";

const UNIT_BATCH_SIZE = 5;
const UNIT_PLAN_CONCURRENCY = 2;
export const MAX_STUDY_ITEMS = 70;

const plannerConceptSchema = z.object({
  conceptKey: z.string().min(3).max(80),
  conceptLabel: z.string().min(3).max(120),
  conceptType: z.string().min(3).max(40),
  studyValue: z.enum(["high", "medium", "low"]),
  recommendedCardCount: z.number().int().min(1).max(3),
  preferredCardStyle: z.string().min(3).max(40),
  supportingExcerpt: z.string().min(1).max(1200),
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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

function normalizeSupportingExcerpt(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length >= 12) {
    return normalized.slice(0, 200);
  }

  const normalizedFallback = fallback.replace(/\s+/g, " ").trim();

  if (normalizedFallback.length >= 12) {
    return normalizedFallback.slice(0, 200);
  }

  return `${normalizedFallback || "Core concept"} - study point`.slice(0, 200);
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
        supportingExcerpt: normalizeSupportingExcerpt(
          concept.supportingExcerpt,
          concept.conceptLabel || unit.text,
        ),
      };
    }),
  };
}

function conceptPriorityScore(
  concept: CoverageConcept,
  plan: CoverageUnitPlan,
  unit: SourceUnit,
) {
  const importanceScore =
    concept.studyValue === "high" || plan.importance === "high" || unit.importance === "high"
      ? 3
      : concept.studyValue === "medium" || plan.importance === "medium" || unit.importance === "medium"
        ? 2
        : 1;
  const styleScore =
    concept.preferredCardStyle === "recall" || concept.preferredCardStyle === "sequence"
      ? 2
      : concept.preferredCardStyle === "compare" || concept.preferredCardStyle === "explain"
        ? 1
        : 0;

  return importanceScore * 10 + styleScore + Math.min(unit.wordCount / 200, 2);
}

function sortConceptsByPriority(
  concepts: CoverageConcept[],
  plan: CoverageUnitPlan,
  unit: SourceUnit,
) {
  return [...concepts].sort(
    (left, right) =>
      conceptPriorityScore(right, plan, unit) - conceptPriorityScore(left, plan, unit),
  );
}

function buildStudyItemTarget(units: SourceUnit[]) {
  const sourceWordCount = units.reduce((total, unit) => total + unit.wordCount, 0);
  const baseTarget = Math.round(sourceWordCount / 30);
  const maxTarget =
    sourceWordCount >= 8000 ? 120 : sourceWordCount >= 5000 ? 100 : 80;

  return clamp(baseTarget, 18, Math.min(maxTarget, MAX_STUDY_ITEMS));
}

function trimPlansToConceptBudget(plans: CoverageUnitPlan[], units: SourceUnit[]) {
  const totalConceptCount = plans.reduce((total, plan) => total + plan.concepts.length, 0);

  if (totalConceptCount <= MAX_STUDY_ITEMS) {
    return plans;
  }

  const unitByIndex = new Map(units.map((unit) => [unit.unitIndex, unit]));
  const planEntries = plans
    .map((plan) => {
      const unit = unitByIndex.get(plan.unitIndex);

      if (!unit || plan.concepts.length === 0) {
        return null;
      }

      return {
        plan,
        unit,
        concepts: sortConceptsByPriority(plan.concepts, plan, unit),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        plan: CoverageUnitPlan;
        unit: SourceUnit;
        concepts: CoverageConcept[];
      } => Boolean(entry),
    )
    .sort((left, right) => {
      const leftBest = conceptPriorityScore(left.concepts[0], left.plan, left.unit);
      const rightBest = conceptPriorityScore(right.concepts[0], right.plan, right.unit);
      return rightBest - leftBest || left.plan.unitIndex - right.plan.unitIndex;
    });

  const selectedConceptKeys = new Set<string>();
  const selectedConceptsByUnit = new Map<number, CoverageConcept[]>();

  function trySelectConcept(entry: {
    plan: CoverageUnitPlan;
    unit: SourceUnit;
    concepts: CoverageConcept[];
  }, concept: CoverageConcept) {
    if (selectedConceptKeys.has(concept.conceptKey)) {
      return false;
    }

    const selected = selectedConceptsByUnit.get(entry.plan.unitIndex) ?? [];
    selected.push(concept);
    selectedConceptsByUnit.set(entry.plan.unitIndex, selected);
    selectedConceptKeys.add(concept.conceptKey);
    return true;
  }

  // Preserve broad coverage first for important units, then use remaining budget
  // on the strongest additional distinct concepts across the whole source.
  const coverageFirstEntries = planEntries
    .filter((entry) => entry.plan.importance !== "low" || entry.unit.importance !== "low")
    .concat(
      planEntries.filter(
        (entry) => entry.plan.importance === "low" && entry.unit.importance === "low",
      ),
    );

  let selectedCount = 0;

  for (const entry of coverageFirstEntries) {
    if (selectedCount >= MAX_STUDY_ITEMS) {
      break;
    }

    const concept = entry.concepts[0];

    if (!concept) {
      continue;
    }

    if (trySelectConcept(entry, concept)) {
      selectedCount += 1;
    }
  }

  const remainingRankedConcepts = planEntries
    .flatMap((entry) =>
      entry.concepts.map((concept, index) => ({
        entry,
        concept,
        index,
        score: conceptPriorityScore(concept, entry.plan, entry.unit),
      })),
    )
    .sort((left, right) => {
      return (
        right.score - left.score ||
        left.index - right.index ||
        left.entry.plan.unitIndex - right.entry.plan.unitIndex
      );
    });

  for (const candidate of remainingRankedConcepts) {
    if (selectedCount >= MAX_STUDY_ITEMS) {
      break;
    }

    if (trySelectConcept(candidate.entry, candidate.concept)) {
      selectedCount += 1;
    }
  }

  return plans.map((plan) => ({
    ...plan,
    concepts: selectedConceptsByUnit.get(plan.unitIndex) ?? [],
  }));
}

function applyStudyItemBudget(plans: CoverageUnitPlan[], units: SourceUnit[]) {
  const trimmedPlans = trimPlansToConceptBudget(plans, units);
  const unitByIndex = new Map(units.map((unit) => [unit.unitIndex, unit]));
  const totalConceptCount = trimmedPlans.reduce((total, plan) => total + plan.concepts.length, 0);
  const targetTotal = Math.min(
    MAX_STUDY_ITEMS,
    Math.max(totalConceptCount, buildStudyItemTarget(units)),
  );
  const normalizedPlans = trimmedPlans.map((plan) => ({
    ...plan,
    concepts: plan.concepts.map((concept) => ({
      ...concept,
      recommendedCardCount: 1,
    })),
  }));
  let remainingBudget = targetTotal - totalConceptCount;

  if (remainingBudget <= 0) {
    return normalizedPlans;
  }

  const rankedConcepts = normalizedPlans
    .flatMap((plan) =>
      plan.concepts.map((concept) => ({
        concept,
        plan,
        unit: unitByIndex.get(plan.unitIndex),
      })),
    )
    .filter(
      (entry): entry is {
        concept: CoverageConcept;
        plan: CoverageUnitPlan;
        unit: SourceUnit;
      } => Boolean(entry.unit),
    )
    .sort(
      (left, right) =>
        conceptPriorityScore(right.concept, right.plan, right.unit) -
        conceptPriorityScore(left.concept, left.plan, left.unit),
    );

  for (let pass = 2; pass <= 3 && remainingBudget > 0; pass += 1) {
    for (const entry of rankedConcepts) {
      if (remainingBudget <= 0) {
        break;
      }

      const originalPlan = trimmedPlans.find((plan) => plan.unitIndex === entry.plan.unitIndex);
      const originalConcept = originalPlan?.concepts.find(
        (concept) => concept.conceptKey === entry.concept.conceptKey,
      );

      if (!originalConcept || originalConcept.recommendedCardCount < pass) {
        continue;
      }

      if (entry.concept.recommendedCardCount >= pass) {
        continue;
      }

      entry.concept.recommendedCardCount = pass;
      remainingBudget -= 1;
    }
  }

  return normalizedPlans;
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
        "Create a study-worthy flashcard plan from the supplied source units. Preserve broad coverage of the material so a student can review the whole lecture through interactive study tools. The final deck and quiz have a strict global budget, so only keep the highest-yield, non-overlapping concepts, but keep adding distinct concepts whenever the material still introduces a new term, rule, model, mechanism, list, formula, step, category, or other study-worthy theme. Prefer atomic, testable facts over broad summaries. Prioritize facts that work well as short recall prompts similar to strong study decks: terminology, direct definitions, acronym meanings, equations, exact lists, named models, categories, classifications, step sequences, concrete numeric or structural facts, protocol purposes, device roles, and important cause-effect claims. When a unit contains several distinct facts, split them into separate concepts rather than merging them, but do not create near-duplicate concepts that test the same idea. If a unit is mostly slide metadata, learning goals, repeated headings, or image/diagram narration such as 'the figure shows ...', return an empty concepts array for that unit. Do not create concepts for generic chapter goals, obvious captions, or paraphrases of the same point. Use high importance only for core exam-relevant facts. Default to one card per concept; recommend two cards when a concept supports two clearly different high-value study angles such as recall plus process/comparison; recommend three cards only for truly dense source units with several distinct facts that deserve fuller review coverage. If a unit can be covered well with one strong concept, keep it to one, but do not undercount genuinely distinct topics just to stay sparse. Favor concepts that can become prompts like 'Kaj je X?', 'Kaj pomeni X?', 'Navedite ...', 'Naštejte ...', 'Dopolnite ...', 'Kateri model ...', or 'Termin: X'.",
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

  return applyStudyItemBudget(
    params.units.map((unit) => normalizeUnitPlan(unit, planByUnit.get(unit.unitIndex))),
    params.units,
  );
}
