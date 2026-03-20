import "server-only";

import type { CoverageCardDraft, CoverageConcept, CoverageUnitPlan, CoverageValidationResult, SourceUnit } from "@/lib/study-models";

function cardHasValidCitation(card: CoverageCardDraft, unit: SourceUnit) {
  return card.citations.some((citation) => Math.abs(citation.idx - unit.unitIndex) <= 1);
}

function cardMatchesUnit(card: CoverageCardDraft, unit: SourceUnit) {
  return (
    card.sourceUnitIdx === unit.unitIndex &&
    card.sourceType === unit.sourceType &&
    card.sourceLocator === unit.locatorLabel
  );
}

function getMissingConcepts(params: {
  unit: SourceUnit;
  plan: CoverageUnitPlan | undefined;
  cards: CoverageCardDraft[];
}) {
  if (!params.plan) {
    return [];
  }

  return params.plan.concepts.filter((concept) => {
    const matchingCards = params.cards.filter((card) => card.conceptKey === concept.conceptKey);
    if (matchingCards.length === 0) {
      return true;
    }

    return matchingCards.every(
      (card) => !cardHasValidCitation(card, params.unit) || !cardMatchesUnit(card, params.unit),
    );
  });
}

export function validateCoverage(params: {
  units: SourceUnit[];
  plans: CoverageUnitPlan[];
  cards: CoverageCardDraft[];
}): CoverageValidationResult {
  const cardsByUnit = new Map<number, CoverageCardDraft[]>();
  const planByUnit = new Map<number, CoverageUnitPlan>();

  for (const plan of params.plans) {
    planByUnit.set(plan.unitIndex, plan);
  }

  for (const card of params.cards) {
    const existing = cardsByUnit.get(card.sourceUnitIdx) ?? [];
    existing.push(card);
    cardsByUnit.set(card.sourceUnitIdx, existing);
  }

  const uncoveredUnitIndexes: number[] = [];
  const criticalUnitIndexes: number[] = [];
  const coveredCriticalUnits: number[] = [];
  const failedConceptKeys: string[] = [];
  const unitsMissingCards: number[] = [];
  const missingConceptsByUnit = new Map<number, CoverageConcept[]>();

  for (const unit of params.units) {
    const plan = planByUnit.get(unit.unitIndex);

    if (plan && plan.concepts.length === 0) {
      continue;
    }

    const unitCards = cardsByUnit.get(unit.unitIndex) ?? [];
    const validUnitCards = unitCards.filter(
      (card) => cardHasValidCitation(card, unit) && cardMatchesUnit(card, unit),
    );

    if (validUnitCards.length === 0) {
      uncoveredUnitIndexes.push(unit.unitIndex);
      unitsMissingCards.push(unit.unitIndex);
    }

    if (unit.importance === "high") {
      criticalUnitIndexes.push(unit.unitIndex);
      if (validUnitCards.length > 0) {
        coveredCriticalUnits.push(unit.unitIndex);
      }
    }

    const missingConcepts = getMissingConcepts({
      unit,
      plan,
      cards: validUnitCards,
    });

    if (missingConcepts.length > 0) {
      missingConceptsByUnit.set(unit.unitIndex, missingConcepts);
      failedConceptKeys.push(...missingConcepts.map((concept) => concept.conceptKey));
    }
  }

  const coverageRatio =
    params.units.length > 0
      ? Number(((params.units.length - uncoveredUnitIndexes.length) / params.units.length).toFixed(3))
      : 0;
  const criticalCoverageRatio =
    criticalUnitIndexes.length > 0
      ? Number((coveredCriticalUnits.length / criticalUnitIndexes.length).toFixed(3))
      : 1;

  return {
    coverageRatio,
    criticalCoverageRatio,
    uncoveredUnitIndexes,
    failedConceptKeys,
    unitsMissingCards,
    missingConceptsByUnit,
  };
}
