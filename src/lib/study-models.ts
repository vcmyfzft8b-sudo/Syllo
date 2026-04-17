import type { Citation, FlashcardDifficulty, LectureRow, TranscriptSegmentRow } from "@/lib/database.types";

export type SourceImportance = "high" | "medium" | "low";

export type CoverageConceptType =
  | "definition"
  | "process"
  | "comparison"
  | "cause_effect"
  | "example"
  | "term"
  | "sequence"
  | "formula"
  | "warning";

export type CoverageCardKind =
  | "recall"
  | "explain"
  | "compare"
  | "apply"
  | "sequence";

export interface SourceUnit {
  lectureId: string;
  unitIndex: number;
  sectionIndex: number;
  sectionTitle: string;
  sourceType: LectureRow["source_type"];
  locatorLabel: string;
  startMs: number | null;
  endMs: number | null;
  pageNumber: number | null;
  text: string;
  wordCount: number;
  importance: SourceImportance;
  rawSourceRef: {
    segmentIndexes: number[];
    speakerLabel: string | null;
  };
}

export interface StudySectionDraft {
  idx: number;
  title: string;
  sourceLabel: string | null;
  sourceStartMs: number | null;
  sourceEndMs: number | null;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  unitStartIdx: number;
  unitEndIdx: number;
}

export interface CoverageConcept {
  conceptKey: string;
  conceptLabel: string;
  conceptType: CoverageConceptType;
  studyValue: SourceImportance;
  qualityScore: number;
  recommendedCardCount: number;
  preferredCardStyle: CoverageCardKind;
  supportingExcerpt: string;
}

export interface CoverageUnitPlan {
  unitIndex: number;
  sectionIndex: number;
  sectionTitle: string;
  importance: SourceImportance;
  concepts: CoverageConcept[];
}

export interface CoverageCardDraft {
  front: string;
  back: string;
  hint: string | null;
  difficulty: FlashcardDifficulty;
  citations: Citation[];
  conceptKey: string;
  cardKind: CoverageCardKind;
  sourceUnitIdx: number;
  sourceType: LectureRow["source_type"];
  sourceLocator: string | null;
  coverageRank: number;
}

export interface CoverageValidationResult {
  coverageRatio: number;
  criticalCoverageRatio: number;
  uncoveredUnitIndexes: number[];
  failedConceptKeys: string[];
  unitsMissingCards: number[];
  missingConceptsByUnit: Map<number, CoverageConcept[]>;
}

export interface SourceUnitBuilderInput {
  lecture: LectureRow;
  transcript: TranscriptSegmentRow[];
  title: string | null;
}
