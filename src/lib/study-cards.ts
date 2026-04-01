import "server-only";

import { z } from "zod";

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
const MAX_CONCEPTS_PER_CARD_BATCH = 3;
const MAX_TARGET_CARDS_PER_CARD_BATCH = 4;

const generatedCitationSchema = z.object({
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  quote: z.string().min(1).max(1600),
});

const generatedCardSchema = z.object({
  front: z.string().min(6).max(140),
  back: z.string().min(1).max(640),
  hint: z.string().min(1).max(220).nullable(),
  difficulty: z.string().min(3).max(40),
  citations: z.array(generatedCitationSchema).min(1).max(6),
  conceptKey: z.string().min(3).max(80),
  cardKind: z.string().min(3).max(40),
  coverageRank: z.number().int().min(0).max(10),
});

const generatedCardBatchSchema = z.object({
  flashcards: z.array(generatedCardSchema).min(1).max(32),
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

function sliceExcerpt(value: string, maxLength: number) {
  return normalizeCardText(value).slice(0, maxLength).trim();
}

function buildFallbackFront(concept: CoverageConcept) {
  const label = sliceExcerpt(concept.conceptLabel, 96) || "Ključni pojem";

  switch (concept.preferredCardStyle) {
    case "sequence":
      return `Naštejte korake: ${label}`;
    case "compare":
      return `Primerjaj: ${label}`;
    case "apply":
      return `Primer uporabe: ${label}`;
    case "explain":
      return `Pojasni: ${label}`;
    case "recall":
    default:
      return `Termin: ${label}`;
  }
}

function buildFallbackBack(concept: CoverageConcept, unit: SourceUnit) {
  const excerpt = sliceExcerpt(concept.supportingExcerpt, 220);

  if (excerpt.length >= 12) {
    return excerpt;
  }

  const sentence = unit.text.split(/(?<=[.!?])\s+/).find((candidate) => normalizeCardText(candidate).length >= 12);
  return sliceExcerpt(sentence ?? unit.text, 220) || "Ključna informacija iz vira.";
}

function buildFallbackCard(params: {
  concept: CoverageConcept;
  unit: SourceUnit;
}): CoverageCardDraft {
  const difficulty: FlashcardDifficulty =
    params.concept.studyValue === "high"
      ? "hard"
      : params.concept.studyValue === "low"
        ? "easy"
        : "medium";

  return normalizeCard({
    front: buildFallbackFront(params.concept),
    back: buildFallbackBack(params.concept, params.unit),
    hint: sliceExcerpt(params.unit.locatorLabel, 120) || null,
    difficulty,
    citations: normalizeCitations({
      citations: [
        {
          idx: params.unit.unitIndex,
          startMs: Math.max(params.unit.startMs ?? 0, 0),
          endMs: Math.max(params.unit.endMs ?? params.unit.startMs ?? 0, params.unit.startMs ?? 0),
          quote: params.concept.supportingExcerpt || params.unit.text,
        },
      ],
      unit: params.unit,
      contextUnits: [],
    }),
    conceptKey: params.concept.conceptKey,
    cardKind: params.concept.preferredCardStyle,
    sourceUnitIdx: params.unit.unitIndex,
    sourceType: params.unit.sourceType,
    sourceLocator: params.unit.locatorLabel,
    coverageRank: params.concept.studyValue === "high" ? 8 : params.concept.studyValue === "medium" ? 6 : 4,
  });
}

function splitConceptsIntoBatches(concepts: CoverageConcept[]) {
  const batches: CoverageConcept[][] = [];
  let currentBatch: CoverageConcept[] = [];
  let currentTargetCount = 0;

  for (const concept of concepts) {
    const conceptTargetCount = Math.max(concept.recommendedCardCount, 1);
    const wouldExceedConceptLimit = currentBatch.length >= MAX_CONCEPTS_PER_CARD_BATCH;
    const wouldExceedTargetLimit =
      currentBatch.length > 0 &&
      currentTargetCount + conceptTargetCount > MAX_TARGET_CARDS_PER_CARD_BATCH;

    if (wouldExceedConceptLimit || wouldExceedTargetLimit) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTargetCount = 0;
    }

    currentBatch.push(concept);
    currentTargetCount += conceptTargetCount;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function buildFallbackQuote(text: string) {
  const normalized = normalizeCardText(text);

  if (normalized.length >= 3) {
    return normalized.slice(0, 180);
  }

  return "Source excerpt";
}

function normalizeCitations(params: {
  citations: Array<{
    idx: number;
    startMs: number;
    endMs: number;
    quote: string;
  }>;
  unit: SourceUnit;
  contextUnits: SourceUnit[];
}) {
  const unitByIndex = new Map(
    [params.unit, ...params.contextUnits].map((unit) => [unit.unitIndex, unit]),
  );
  const fallbackUnit = params.unit;

  return params.citations.slice(0, 2).map((citation) => {
    const sourceUnit = unitByIndex.get(citation.idx) ?? fallbackUnit;
    const normalizedQuote = normalizeCardText(citation.quote);
    const fallbackQuote = buildFallbackQuote(sourceUnit.text);

    return {
      idx: citation.idx,
      startMs: citation.startMs,
      endMs: citation.endMs,
      quote: normalizedQuote.length >= 3 ? normalizedQuote.slice(0, 180) : fallbackQuote,
    };
  });
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

async function generateCardsForConceptBatch(params: {
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
    maxOutputTokens: Math.max(2600, targetCount * 560),
    instructions:
      `${languageInstruction}
${params.repairOnly ? "Repair missing concept coverage." : "Generate source-grounded study flashcards."}
Use only the supplied source units.
Cover every requested concept explicitly.
Make the deck feel like a high-quality study deck built for full-course review.
Prefer short, atomic cards over broad paraphrases.
Prioritize card fronts in patterns like:
- "Kaj je X?"
- "Kaj pomeni X?"
- "Kateri/Katera/Katero ...?"
- "Navedite/Naštejte ..."
- "Dopolnite: ..."
- "Termin: X"
- "Definicija: X"
Produce mixed study cards:
- recall cards for essential terms, definitions, names, dates, formulas, models, categories, and exact facts
- explain cards for how and why, but only when the mechanism itself is important
- compare cards for contrasts
- sequence cards for steps and ordered processes
- apply cards only when the source includes an example or practical case
Do not collapse different concepts into one card.
When a concept requests multiple cards, make them materially different from each other and cover distinct angles such as recall, explanation, comparison, or process from the same source concept.
Do not create repetitive cards that test the same fact with only superficial wording changes.
If a concept is simple, prefer one excellent card over multiple weaker cards.
Do not invent facts or examples.
Every card must cite 1 or 2 source units and the answer must be fully supported by those citations.
Use the provided conceptKey exactly.
Prefer concise, exam-style cards over broad explanatory paraphrases.
Prefer direct definition, acronym, device-role, protocol-purpose, equation-completion, classification, and exact-list cards.
Use fill-in-the-blank cards when the source contains equations, named formulas, paired concepts, or canonical phrases worth memorizing.
Use "Termin: X" fronts when the answer should be a concise definition.
Use "Definicija: ..." fronts when the student should name the term.
Use "Navedite/Naštejte ..." when the source gives an exact set that matters.
Only use broad "zakaj" or "kako" explanation cards when the source clearly teaches a mechanism or ordered process that matters to understand, not just to recall.
For acronyms, named protocols, named devices, or named services, prefer direct cards such as "Kaj pomeni kratica X?" or "Kaj je vloga X?".
For list facts, ask for the complete set only when the set itself matters.
Do not create cards about generic chapter goals, obvious figure captions, or "what does the picture show" unless the figure adds a distinct fact not stated elsewhere.
Backs should usually be very short: one phrase, one sentence, one exact value, or one short list item unless a full sequence is required.
Keep answers close to memorization form rather than long explanations.
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
        citations: normalizeCitations({
          citations: card.citations,
          unit: params.unit,
          contextUnits: params.contextUnits,
        }),
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

async function generateCardsForConceptBatchWithFallback(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  unit: SourceUnit;
  plan: CoverageUnitPlan;
  contextUnits: SourceUnit[];
  concepts: CoverageConcept[];
  outputLanguage?: string | null;
  repairOnly?: boolean;
}): Promise<CoverageCardDraft[]> {
  try {
    return await generateCardsForConceptBatch(params);
  } catch (error) {
    if (params.concepts.length > 1) {
      const conceptBatches = splitConceptsIntoBatches(params.concepts);

      if (conceptBatches.length > 1) {
        const recovered = await mapWithConcurrency(conceptBatches, 1, async (concepts) =>
          generateCardsForConceptBatchWithFallback({
            ...params,
            concepts,
          }),
        );

        return dedupeCards(recovered.flat());
      }

      const midpoint = Math.ceil(params.concepts.length / 2);
      const recovered = await Promise.all([
        generateCardsForConceptBatchWithFallback({
          ...params,
          concepts: params.concepts.slice(0, midpoint),
        }),
        generateCardsForConceptBatchWithFallback({
          ...params,
          concepts: params.concepts.slice(midpoint),
        }),
      ]);

      return dedupeCards(recovered.flat());
    }

    const [concept] = params.concepts;
    console.warn("Falling back to deterministic flashcard generation for concept", {
      unitIndex: params.unit.unitIndex,
      conceptKey: concept?.conceptKey,
      error: error instanceof Error ? error.message : String(error),
    });

    return concept ? [buildFallbackCard({ concept, unit: params.unit })] : [];
  }
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
  const conceptBatches = splitConceptsIntoBatches(params.concepts);
  const generatedBatches = await mapWithConcurrency(conceptBatches, 1, async (concepts) =>
    generateCardsForConceptBatchWithFallback({
      ...params,
      concepts,
    }),
  );

  return dedupeCards(generatedBatches.flat());
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
