import "server-only";

import type {
  Citation,
  FlashcardDifficulty,
  FlashcardRow,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySectionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { countWords } from "@/lib/note-generation";
import { createCoveragePlan } from "@/lib/study-coverage";
import { generateCoverageCards, repairCoverageCards } from "@/lib/study-cards";
import type { CoverageCardDraft, CoverageUnitPlan, SourceUnit, StudySectionDraft } from "@/lib/study-models";
import { buildSourceUnits } from "@/lib/study-source-units";
import { validateCoverage } from "@/lib/study-validation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const COVERAGE_TARGET = 0.9;
const CRITICAL_COVERAGE_TARGET = 1;
const MAX_REPAIR_PASSES = 2;

type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type StudyStorageMode = "comprehensive" | "legacy";

type StudyStorageCapabilities = {
  mode: StudyStorageMode;
  supportsSections: boolean;
  supportsFlashcardCoverageFields: boolean;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as PostgrestLikeError;
    const parts = [candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown flashcard generation error.";
}

function getSchemaErrorText(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const candidate = error as PostgrestLikeError;
  return [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function isMissingStudySectionsSchemaError(error: unknown) {
  const text = getSchemaErrorText(error);

  if (!text) {
    return false;
  }

  return (
    text.includes("lecture_study_sections") &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("42p01") ||
      text.includes("pgrst"))
  );
}

function isMissingFlashcardCoverageSchemaError(error: unknown) {
  const text = getSchemaErrorText(error);

  if (!text) {
    return false;
  }

  const mentionsCoverageField =
    text.includes("section_id") ||
    text.includes("source_unit_idx") ||
    text.includes("card_kind") ||
    text.includes("concept_key") ||
    text.includes("source_type") ||
    text.includes("source_locator") ||
    text.includes("coverage_rank");

  return (
    mentionsCoverageField &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("42703") ||
      text.includes("pgrst"))
  );
}

async function detectStudyStorageCapabilities(): Promise<StudyStorageCapabilities> {
  const supabase = createSupabaseServiceRoleClient();

  const [
    { error: sectionsError },
    { error: flashcardCoverageFieldsError },
  ] = await Promise.all([
    supabase.from("lecture_study_sections").select("id").limit(1),
    supabase
      .from("flashcards")
      .select(
        "id, section_id, source_unit_idx, card_kind, concept_key, source_type, source_locator, coverage_rank",
      )
      .limit(1),
  ]);

  if (sectionsError && !isMissingStudySectionsSchemaError(sectionsError)) {
    throw sectionsError;
  }

  if (
    flashcardCoverageFieldsError &&
    !isMissingFlashcardCoverageSchemaError(flashcardCoverageFieldsError)
  ) {
    throw flashcardCoverageFieldsError;
  }

  const supportsSections = !sectionsError;
  const supportsFlashcardCoverageFields = !flashcardCoverageFieldsError;

  return {
    mode:
      supportsSections && supportsFlashcardCoverageFields ? "comprehensive" : "legacy",
    supportsSections,
    supportsFlashcardCoverageFields,
  };
}

async function setStudyAssetStatus(params: {
  lectureId: string;
  status: LectureStudyAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();

  const payload = {
    lecture_id: params.lectureId,
    status: params.status,
    error_message: params.errorMessage ?? null,
    model_metadata: params.modelMetadata ?? {},
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("lecture_study_assets")
    .upsert(payload as never, { onConflict: "lecture_id" });

  if (error) {
    throw error;
  }
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeAcceptedCards(cards: CoverageCardDraft[]) {
  const seen = new Set<string>();
  const output: CoverageCardDraft[] = [];

  for (const card of cards) {
    const key = `${card.conceptKey}::${card.cardKind}::${normalizeText(card.front)}::${normalizeText(card.back)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(card);
  }

  return output;
}

function selectAcceptedCards(params: {
  cards: CoverageCardDraft[];
  plans: CoverageUnitPlan[];
  units: SourceUnit[];
}) {
  const planByUnit = new Map(params.plans.map((plan) => [plan.unitIndex, plan]));
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));

  return dedupeAcceptedCards(
    params.cards.filter((card) => {
      const plan = planByUnit.get(card.sourceUnitIdx);
      const unit = unitByIndex.get(card.sourceUnitIdx);

      if (!plan || !unit) {
        return false;
      }

      if (card.sourceType !== unit.sourceType || card.sourceLocator !== unit.locatorLabel) {
        return false;
      }

      if (!plan.concepts.some((concept) => concept.conceptKey === card.conceptKey)) {
        return false;
      }

      return card.citations.some((citation) => Math.abs(citation.idx - unit.unitIndex) <= 1);
    }),
  );
}

function buildSectionRows(params: {
  lectureId: string;
  sections: StudySectionDraft[];
  cards: CoverageCardDraft[];
}) {
  return params.sections.map((section) => ({
    lecture_id: params.lectureId,
    idx: section.idx,
    title: section.title,
    source_label: section.sourceLabel,
    source_start_ms: section.sourceStartMs,
    source_end_ms: section.sourceEndMs,
    source_page_start: section.sourcePageStart,
    source_page_end: section.sourcePageEnd,
    unit_start_idx: section.unitStartIdx,
    unit_end_idx: section.unitEndIdx,
    card_count: params.cards.filter((card) => {
      const unitSectionIndex = params.sections.find(
        (candidate) =>
          card.sourceUnitIdx >= candidate.unitStartIdx &&
          card.sourceUnitIdx <= candidate.unitEndIdx,
      )?.idx;
      return unitSectionIndex === section.idx;
    }).length,
  }));
}

function buildFlashcardsToInsert(params: {
  lectureId: string;
  cards: CoverageCardDraft[];
  units: SourceUnit[];
  insertedSections: LectureStudySectionRow[];
}) {
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const sectionIdByIndex = new Map(params.insertedSections.map((section) => [section.idx, section.id]));

  return params.cards.map((card, index) => {
    const unit = unitByIndex.get(card.sourceUnitIdx);
    const sectionId = unit ? sectionIdByIndex.get(unit.sectionIndex) ?? null : null;

    return {
      lecture_id: params.lectureId,
      idx: index,
      front: card.front,
      back: card.back,
      hint: card.hint?.trim() ? card.hint.trim() : null,
      citations_json: card.citations as unknown as Citation[],
      difficulty: card.difficulty,
      section_id: sectionId,
      source_unit_idx: card.sourceUnitIdx,
      card_kind: card.cardKind,
      concept_key: card.conceptKey,
      source_type: card.sourceType,
      source_locator: card.sourceLocator,
      coverage_rank: card.coverageRank,
    };
  });
}

function toLegacyFlashcardInsertRow(
  flashcard:
    | FlashcardRow
    | {
        lecture_id: string;
        idx: number;
        front: string;
        back: string;
        hint: string | null;
        citations_json: Citation[];
        difficulty: FlashcardDifficulty;
      },
) {
  return {
    lecture_id: flashcard.lecture_id,
    idx: flashcard.idx,
    front: flashcard.front,
    back: flashcard.back,
    hint: flashcard.hint,
    citations_json: flashcard.citations_json as unknown as Citation[],
    difficulty: flashcard.difficulty,
  };
}

function buildLegacyFlashcardsToInsert(params: {
  lectureId: string;
  cards: CoverageCardDraft[];
}) {
  return params.cards.map((card, index) =>
    toLegacyFlashcardInsertRow({
      lecture_id: params.lectureId,
      idx: index,
      front: card.front,
      back: card.back,
      hint: card.hint?.trim() ? card.hint.trim() : null,
      citations_json: card.citations as unknown as Citation[],
      difficulty: card.difficulty,
    }),
  );
}

async function restorePreviousDeck(params: {
  lectureId: string;
  previousSections: LectureStudySectionRow[];
  previousFlashcards: FlashcardRow[];
  storage: StudyStorageCapabilities;
}) {
  const supabase = createSupabaseServiceRoleClient();

  await supabase.from("flashcards").delete().eq("lecture_id", params.lectureId);

  if (params.storage.supportsSections) {
    await supabase.from("lecture_study_sections").delete().eq("lecture_id", params.lectureId);
  }

  if (params.storage.supportsSections && params.previousSections.length > 0) {
    await supabase.from("lecture_study_sections").insert(
      params.previousSections.map((section) => ({
        ...section,
      })) as never,
    );
  }

  if (params.previousFlashcards.length > 0) {
    const flashcardsToRestore =
      params.storage.mode === "comprehensive"
        ? params.previousFlashcards.map((flashcard) => ({
            ...flashcard,
          }))
        : params.previousFlashcards.map(toLegacyFlashcardInsertRow);

    await supabase.from("flashcards").insert(flashcardsToRestore as never);
  }
}

async function fetchExistingDeck(
  lectureId: string,
  storage: StudyStorageCapabilities,
) {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: flashcards, error: flashcardsError }, sectionsResult] = await Promise.all([
    supabase
      .from("flashcards")
      .select("*")
      .eq("lecture_id", lectureId)
      .order("idx", { ascending: true }),
    storage.supportsSections
      ? supabase
          .from("lecture_study_sections")
          .select("*")
          .eq("lecture_id", lectureId)
          .order("idx", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sectionsResult.error) {
    if (isMissingStudySectionsSchemaError(sectionsResult.error)) {
      storage.supportsSections = false;
      storage.mode = "legacy";
    } else {
      throw sectionsResult.error;
    }
  }

  if (flashcardsError) {
    throw flashcardsError;
  }

  return {
    sections: (sectionsResult.data ?? []) as LectureStudySectionRow[],
    flashcards: (flashcards ?? []) as FlashcardRow[],
  };
}

export async function generateLectureFlashcards(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();
  const startedAt = Date.now();
  const storage = await detectStudyStorageCapabilities();

  await setStudyAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
    modelMetadata: {
      stage: "building_sections",
      pipeline: "flashcards-v4",
      storageMode: storage.mode,
    },
  });

  try {
    const [{ data: lecture, error: lectureError }, { data: artifact, error: artifactError }, { data: transcript, error: transcriptError }, existingDeck] =
      await Promise.all([
        supabase
          .from("lectures")
          .select("*")
          .eq("id", params.lectureId)
          .single(),
        supabase
          .from("lecture_artifacts")
          .select("*")
          .eq("lecture_id", params.lectureId)
          .single(),
        supabase
          .from("transcript_segments")
          .select("*")
          .eq("lecture_id", params.lectureId)
          .order("idx", { ascending: true }),
        fetchExistingDeck(params.lectureId, storage),
      ]);

    if (lectureError) {
      throw lectureError;
    }

    if (artifactError) {
      throw artifactError;
    }

    if (transcriptError) {
      throw transcriptError;
    }

    const lectureRow = lecture as LectureRow;
    const artifactRow = artifact as LectureArtifactRow;
    const transcriptRows = (transcript ?? []) as TranscriptSegmentRow[];

    if (lectureRow.status !== "ready") {
      throw new Error("Flashcards are available after note processing finishes.");
    }

    if (transcriptRows.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const { units, sections } = buildSourceUnits({
      lecture: lectureRow,
      transcript: transcriptRows,
    });

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "planning_coverage",
        pipeline: "flashcards-v4",
        storageMode: storage.mode,
        sourceUnitCount: units.length,
        sectionCount: sections.length,
      },
    });

    const plannedCoverage = await createCoveragePlan({
      title: lectureRow.title,
      summary: artifactRow.summary,
      keyTopics: artifactRow.key_topics,
      units,
    });
    const planByUnit = new Map(plannedCoverage.map((plan) => [plan.unitIndex, plan]));
    const effectiveUnits = units.map((unit) => ({
      ...unit,
      importance: planByUnit.get(unit.unitIndex)?.importance ?? unit.importance,
    }));

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "generating_cards",
        pipeline: "flashcards-v4",
        storageMode: storage.mode,
        sourceUnitCount: effectiveUnits.length,
        sectionCount: sections.length,
        plannedConceptCount: plannedCoverage.reduce((total, plan) => total + plan.concepts.length, 0),
      },
    });

    let generatedCards = await generateCoverageCards({
      title: lectureRow.title,
      summary: artifactRow.summary,
      keyTopics: artifactRow.key_topics,
      units: effectiveUnits,
      plans: plannedCoverage,
      outputLanguage: lectureRow.language_hint,
    });

    let validation = validateCoverage({
      units: effectiveUnits,
      plans: plannedCoverage,
      cards: generatedCards,
    });

    for (let repairPass = 0; repairPass < MAX_REPAIR_PASSES; repairPass += 1) {
      if (
        validation.coverageRatio >= COVERAGE_TARGET &&
        validation.criticalCoverageRatio >= CRITICAL_COVERAGE_TARGET &&
        validation.failedConceptKeys.length === 0
      ) {
        break;
      }

      await setStudyAssetStatus({
        lectureId: params.lectureId,
        status: "generating",
        modelMetadata: {
          stage: "repairing_coverage",
          pipeline: "flashcards-v4",
          storageMode: storage.mode,
          repairPass: repairPass + 1,
          uncoveredUnitIndexes: validation.uncoveredUnitIndexes,
          failedConceptKeys: validation.failedConceptKeys,
        },
      });

      const repairedCards = await repairCoverageCards({
        title: lectureRow.title,
        summary: artifactRow.summary,
        keyTopics: artifactRow.key_topics,
        units: effectiveUnits,
        plans: plannedCoverage,
        missingConceptsByUnit: validation.missingConceptsByUnit,
        outputLanguage: lectureRow.language_hint,
      });

      generatedCards = dedupeAcceptedCards([...generatedCards, ...repairedCards]);
      validation = validateCoverage({
        units: effectiveUnits,
        plans: plannedCoverage,
        cards: generatedCards,
      });
    }

    const acceptedCards = selectAcceptedCards({
      cards: generatedCards,
      plans: plannedCoverage,
      units: effectiveUnits,
    });
    const acceptedValidation = validateCoverage({
      units: effectiveUnits,
      plans: plannedCoverage,
      cards: acceptedCards,
    });

    if (
      acceptedValidation.coverageRatio < COVERAGE_TARGET ||
      acceptedValidation.criticalCoverageRatio < CRITICAL_COVERAGE_TARGET ||
      acceptedValidation.failedConceptKeys.length > 0
    ) {
      throw new Error(
        `Coverage validation failed (${acceptedValidation.coverageRatio} overall, ${acceptedValidation.criticalCoverageRatio} critical).`,
      );
    }

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "publishing_deck",
        pipeline: "flashcards-v4",
        storageMode: storage.mode,
        coverageRatio: acceptedValidation.coverageRatio,
        criticalCoverageRatio: acceptedValidation.criticalCoverageRatio,
        generatedCardCount: generatedCards.length,
        acceptedCardCount: acceptedCards.length,
      },
    });

    const sectionRows = buildSectionRows({
      lectureId: params.lectureId,
      sections,
      cards: acceptedCards,
    });

    const { error: deleteFlashcardsError } = await supabase
      .from("flashcards")
      .delete()
      .eq("lecture_id", params.lectureId);

    if (deleteFlashcardsError) {
      throw deleteFlashcardsError;
    }

    let insertedSections: LectureStudySectionRow[] = [];

    if (storage.supportsSections) {
      const { error: deleteSectionsError } = await supabase
        .from("lecture_study_sections")
        .delete()
        .eq("lecture_id", params.lectureId);

      if (deleteSectionsError) {
        throw deleteSectionsError;
      }

      const { data, error: sectionInsertError } = await supabase
        .from("lecture_study_sections")
        .insert(sectionRows as never)
        .select("*");

      if (sectionInsertError || !data) {
        await restorePreviousDeck({
          lectureId: params.lectureId,
          previousSections: existingDeck.sections,
          previousFlashcards: existingDeck.flashcards,
          storage,
        });
        throw new Error(sectionInsertError?.message ?? "Study sections could not be saved.");
      }

      insertedSections = data as LectureStudySectionRow[];
    }

    const flashcardsToInsert =
      storage.mode === "comprehensive"
        ? buildFlashcardsToInsert({
            lectureId: params.lectureId,
            cards: acceptedCards,
            units: effectiveUnits,
            insertedSections,
          })
        : buildLegacyFlashcardsToInsert({
            lectureId: params.lectureId,
            cards: acceptedCards,
          });

    const { error: flashcardInsertError } = await supabase
      .from("flashcards")
      .insert(flashcardsToInsert as never);

    if (flashcardInsertError) {
      await restorePreviousDeck({
        lectureId: params.lectureId,
        previousSections: existingDeck.sections,
        previousFlashcards: existingDeck.flashcards,
        storage,
      });
      throw new Error(flashcardInsertError.message);
    }

    const difficultyCounts = acceptedCards.reduce<Record<FlashcardDifficulty, number>>(
      (counts, flashcard) => {
        counts[flashcard.difficulty] += 1;
        return counts;
      },
      {
        easy: 0,
        medium: 0,
        hard: 0,
      },
    );

    const noteWordCount = countWords(artifactRow.structured_notes_md);
    const sourceWordCount = transcriptRows.reduce(
      (total, segment) => total + countWords(segment.text),
      0,
    );

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "ready",
      modelMetadata: {
        stage: "ready",
        pipeline: "flashcards-v4",
        storageMode: storage.mode,
        sourceUnitCount: effectiveUnits.length,
        sectionCount: sections.length,
        plannedConceptCount: plannedCoverage.reduce((total, plan) => total + plan.concepts.length, 0),
        generatedCardCount: generatedCards.length,
        acceptedCardCount: acceptedCards.length,
        coverageRatio: acceptedValidation.coverageRatio,
        criticalCoverageRatio: acceptedValidation.criticalCoverageRatio,
        uncoveredUnitIndexes: acceptedValidation.uncoveredUnitIndexes,
        failedConceptKeys: acceptedValidation.failedConceptKeys,
        generationDurationMs: Date.now() - startedAt,
        difficultyCounts,
        sourceWordCount,
        noteWordCount,
        sectionSummaries: sectionRows.map((section) => ({
          idx: section.idx,
          title: section.title,
          cardCount: section.card_count,
        })),
      },
    });
  } catch (error) {
    console.error("Flashcard generation failed", {
      lectureId: params.lectureId,
      error,
    });

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: {
        pipeline: "flashcards-v4",
        stage: "failed",
      },
    });

    throw error;
  }
}
