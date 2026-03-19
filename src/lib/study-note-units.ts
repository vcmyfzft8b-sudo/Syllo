import "server-only";

import type { LectureArtifactRow, LectureRow, TranscriptSegmentRow } from "@/lib/database.types";
import { countWords } from "@/lib/note-generation";
import type {
  CoverageCardKind,
  CoverageConcept,
  CoverageConceptType,
  CoverageUnitPlan,
  SourceImportance,
  SourceUnit,
  StudySectionDraft,
} from "@/lib/study-models";
import type { NoteStudyPoint, NoteStudyPointType, NoteStudySection } from "@/lib/types";
import { getOpenAiClient } from "@/lib/ai/openai";
import { noteStudyOutlineSchema } from "@/lib/ai/schemas";
import { getServerEnv } from "@/lib/server-env";
import { parseVector } from "@/lib/utils";

const MATCH_COUNT = 2;

type TranscriptMatch = {
  segment: TranscriptSegmentRow;
  score: number;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function inferPointType(text: string): NoteStudyPointType {
  if (/\b(compare|contrast|versus|vs\.?|difference)\b/i.test(text)) {
    return "comparison";
  }

  if (/\b(first|next|then|finally|step|sequence|process)\b/i.test(text)) {
    return "sequence";
  }

  if (/\bcauses?|results? in|leads? to|because|therefore|so that\b/i.test(text)) {
    return "cause_effect";
  }

  if (/\bformula|equation|calculate|sum|ratio|probability\b/i.test(text)) {
    return "formula";
  }

  if (/\bwarning|avoid|do not|never|risk|pitfall|caution\b/i.test(text)) {
    return "warning";
  }

  if (/\bexample|for instance|for example|case\b/i.test(text)) {
    return "example";
  }

  if (/\bis defined as|refers to|means\b/i.test(text)) {
    return "definition";
  }

  return "term";
}

function inferStudyValue(text: string): SourceImportance {
  const wordCount = countWords(text);

  if (wordCount >= 26) {
    return "high";
  }

  if (wordCount >= 14) {
    return "medium";
  }

  return "low";
}

function makePointKey(sectionTitle: string, pointText: string, sectionIndex: number, pointIndex: number) {
  return `${sectionIndex}-${pointIndex}-${slugify(sectionTitle)}-${slugify(pointText) || "point"}`.slice(
    0,
    80,
  );
}

function sanitizePoint(point: Partial<NoteStudyPoint>, sectionTitle: string, sectionIndex: number, pointIndex: number): NoteStudyPoint | null {
  const text = normalizeWhitespace(point.text ?? "");

  if (text.length < 12) {
    return null;
  }

  return {
    pointKey: point.pointKey?.trim() || makePointKey(sectionTitle, text, sectionIndex, pointIndex),
    text,
    pointType: point.pointType ?? inferPointType(text),
    studyValue: point.studyValue ?? inferStudyValue(text),
  };
}

function parseMarkdownOutline(markdown: string): NoteStudySection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Array<{
    title: string;
    summary: string;
    points: string[];
  }> = [];
  let current = {
    title: "Core notes",
    summary: "",
    points: [] as string[],
  };
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    const paragraph = normalizeWhitespace(paragraphBuffer.join(" "));
    paragraphBuffer = [];

    if (paragraph.length < 16) {
      return;
    }

    if (!current.summary) {
      current.summary = paragraph.slice(0, 400);
      return;
    }

    current.points.push(paragraph.slice(0, 320));
  }

  function flushSection() {
    flushParagraph();

    if (current.title || current.summary || current.points.length > 0) {
      sections.push({
        title: current.title || `Section ${sections.length + 1}`,
        summary: current.summary || current.points[0] || current.title || "Core notes",
        points: current.points,
      });
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushSection();
      current = {
        title: normalizeWhitespace(headingMatch[2]),
        summary: "",
        points: [],
      };
      continue;
    }

    const bulletMatch = line.match(/^[-*+]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      current.points.push(normalizeWhitespace(bulletMatch[1]).slice(0, 320));
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushSection();

  return sections
    .map((section, sectionIndex) => ({
      title: section.title,
      summary: section.summary,
      points: section.points
        .map((point, pointIndex) =>
          sanitizePoint({ text: point }, section.title, sectionIndex, pointIndex),
        )
        .filter((point): point is NoteStudyPoint => point !== null),
    }))
    .filter((section) => section.points.length > 0);
}

function extractStudyOutline(artifact: LectureArtifactRow) {
  const metadata = artifact.model_metadata;
  const rawOutline =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? "studyOutline" in metadata
        ? metadata.studyOutline
        : null
      : null;

  const parsed = noteStudyOutlineSchema.safeParse(rawOutline);
  if (parsed.success) {
    return {
      outline: parsed.data,
      source: "study_outline" as const,
    };
  }

  return {
    outline: parseMarkdownOutline(artifact.structured_notes_md),
    source: "markdown_fallback" as const,
  };
}

function parsePageNumber(label: string | null) {
  if (!label) {
    return null;
  }

  const match = label.match(/page\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function tokenize(value: string) {
  return new Set(
    normalizeWhitespace(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length > 2),
  );
}

function lexicalSimilarity(left: string, right: string) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.sqrt(leftTokens.size * rightTokens.size);
}

async function createEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const openai = getOpenAiClient();
  const response = await openai.embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

function selectTranscriptMatches(params: {
  pointText: string;
  pointEmbedding: number[] | null;
  transcript: Array<{
    segment: TranscriptSegmentRow;
    embedding: number[] | null;
  }>;
}) {
  const ranked = params.transcript
    .map<TranscriptMatch>((entry) => ({
      segment: entry.segment,
      score: params.pointEmbedding && entry.embedding
        ? cosineSimilarity(params.pointEmbedding, entry.embedding)
        : lexicalSimilarity(params.pointText, entry.segment.text),
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0] ?? null;
  if (!best) {
    return [];
  }

  const threshold = params.pointEmbedding ? Math.max(best.score - 0.06, 0.36) : Math.max(best.score - 0.08, 0.12);

  return ranked
    .filter((match, index) => index === 0 || match.score >= threshold)
    .slice(0, MATCH_COUNT)
    .map((match) => match.segment);
}

function pointTypeToCardKind(pointType: NoteStudyPointType): CoverageCardKind {
  if (pointType === "comparison") {
    return "compare";
  }

  if (pointType === "example") {
    return "apply";
  }

  if (pointType === "process" || pointType === "sequence") {
    return "sequence";
  }

  if (pointType === "cause_effect" || pointType === "warning") {
    return "explain";
  }

  return "recall";
}

function buildConcept(unit: SourceUnit, pointType: NoteStudyPointType): CoverageConcept {
  return {
    conceptKey: `note-${unit.unitIndex}-${slugify(unit.text) || "concept"}`.slice(0, 80),
    conceptLabel: unit.text.slice(0, 110),
    conceptType: pointType as CoverageConceptType,
    studyValue: unit.importance,
    recommendedCardCount: 1,
    preferredCardStyle: pointTypeToCardKind(pointType),
    supportingExcerpt: unit.text.slice(0, 200),
  };
}

function buildSectionDrafts(units: SourceUnit[], lecture: LectureRow): StudySectionDraft[] {
  const sections = new Map<number, StudySectionDraft>();

  for (const unit of units) {
    const current = sections.get(unit.sectionIndex);

    if (!current) {
      sections.set(unit.sectionIndex, {
        idx: unit.sectionIndex,
        title: unit.sectionTitle,
        sourceLabel:
          lecture.source_type === "audio"
            ? unit.startMs != null && unit.endMs != null
              ? `${unit.locatorLabel} · ${unit.startMs === unit.endMs ? unit.locatorLabel : "Source range"}`
              : unit.locatorLabel
            : unit.pageNumber != null
              ? `Page ${unit.pageNumber}`
              : unit.locatorLabel,
        sourceStartMs: unit.startMs,
        sourceEndMs: unit.endMs,
        sourcePageStart: unit.pageNumber,
        sourcePageEnd: unit.pageNumber,
        unitStartIdx: unit.unitIndex,
        unitEndIdx: unit.unitIndex,
      });
      continue;
    }

    current.unitStartIdx = Math.min(current.unitStartIdx, unit.unitIndex);
    current.unitEndIdx = Math.max(current.unitEndIdx, unit.unitIndex);
    current.sourceStartMs =
      current.sourceStartMs == null ? unit.startMs : Math.min(current.sourceStartMs, unit.startMs ?? current.sourceStartMs);
    current.sourceEndMs =
      current.sourceEndMs == null ? unit.endMs : Math.max(current.sourceEndMs, unit.endMs ?? current.sourceEndMs);
    current.sourcePageStart =
      current.sourcePageStart == null ? unit.pageNumber : Math.min(current.sourcePageStart, unit.pageNumber ?? current.sourcePageStart);
    current.sourcePageEnd =
      current.sourcePageEnd == null ? unit.pageNumber : Math.max(current.sourcePageEnd, unit.pageNumber ?? current.sourcePageEnd);
  }

  return [...sections.values()]
    .map((section) => ({
      ...section,
      sourceLabel:
        lecture.source_type === "audio"
          ? section.sourceStartMs != null && section.sourceEndMs != null
            ? `${section.title} · ${Math.floor(section.sourceStartMs / 60000)
                .toString()
                .padStart(2, "0")}:${Math.floor((section.sourceStartMs % 60000) / 1000)
                .toString()
                .padStart(2, "0")}-${Math.floor(section.sourceEndMs / 60000)
                .toString()
                .padStart(2, "0")}:${Math.floor((section.sourceEndMs % 60000) / 1000)
                .toString()
                .padStart(2, "0")}`
            : section.title
          : section.sourcePageStart != null && section.sourcePageEnd != null
            ? section.sourcePageStart === section.sourcePageEnd
              ? `Page ${section.sourcePageStart}`
              : `Pages ${section.sourcePageStart}-${section.sourcePageEnd}`
            : section.title,
    }))
    .sort((left, right) => left.idx - right.idx);
}

export async function buildNoteStudyMaterials(params: {
  lecture: LectureRow;
  artifact: LectureArtifactRow;
  transcript: TranscriptSegmentRow[];
}) {
  const { outline, source } = extractStudyOutline(params.artifact);

  if (outline.length === 0) {
    throw new Error("The notes did not contain enough structured study points.");
  }

  const points = outline.flatMap((section) => section.points);
  const transcript = params.transcript.map((segment) => ({
    segment,
    embedding: segment.embedding ? parseVector(segment.embedding) : null,
  }));
  const pointEmbeddings = transcript.some((entry) => entry.embedding)
    ? await createEmbeddings(points.map((point) => point.text))
    : [];

  const units: SourceUnit[] = [];
  const pointTypes = new Map<number, NoteStudyPointType>();
  let pointIndex = 0;

  for (const [sectionIndex, section] of outline.entries()) {
    for (const point of section.points) {
      const matches = selectTranscriptMatches({
        pointText: point.text,
        pointEmbedding: pointEmbeddings[pointIndex] ?? null,
        transcript,
      });
      const startMs =
        matches.length > 0 ? Math.min(...matches.map((segment) => segment.start_ms)) : 0;
      const endMs =
        matches.length > 0 ? Math.max(...matches.map((segment) => segment.end_ms)) : startMs;
      const pageNumbers = matches
        .map((segment) => parsePageNumber(segment.speaker_label))
        .filter((value): value is number => value !== null);

      units.push({
        lectureId: params.lecture.id,
        unitIndex: units.length,
        sectionIndex,
        sectionTitle: section.title,
        sourceType: params.lecture.source_type,
        locatorLabel: section.title,
        startMs,
        endMs,
        pageNumber: pageNumbers[0] ?? null,
        text: point.text,
        wordCount: countWords(point.text),
        importance: point.studyValue,
        rawSourceRef: {
          segmentIndexes: matches.map((segment) => segment.idx),
          speakerLabel: matches[0]?.speaker_label ?? null,
        },
      });
      pointTypes.set(units[units.length - 1].unitIndex, point.pointType);
      pointIndex += 1;
    }
  }

  const plans: CoverageUnitPlan[] = units.map((unit) => ({
    unitIndex: unit.unitIndex,
    sectionIndex: unit.sectionIndex,
    sectionTitle: unit.sectionTitle,
    importance: unit.importance,
    concepts: [buildConcept(unit, pointTypes.get(unit.unitIndex) ?? inferPointType(unit.text))],
  }));

  return {
    units,
    sections: buildSectionDrafts(units, params.lecture),
    plans,
    outlineSource: source,
    notePointCount: points.length,
  };
}
