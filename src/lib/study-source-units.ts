import "server-only";

import type { LectureRow, TranscriptSegmentRow } from "@/lib/database.types";
import { countWords } from "@/lib/note-generation";
import type { SourceImportance, SourceUnit, StudySectionDraft } from "@/lib/study-models";

const AUDIO_UNIT_TARGET_WORDS = 110;
const AUDIO_UNIT_MAX_WORDS = 145;
const AUDIO_SECTION_TARGET_MS = 6 * 60 * 1000;

function normalizeLabel(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function formatTimestampLabel(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function inferImportance(text: string): SourceImportance {
  const wordCount = countWords(text);

  if (wordCount >= 90) {
    return "high";
  }

  if (wordCount >= 40) {
    return "medium";
  }

  return "low";
}

function parsePageNumber(label: string | null) {
  if (!label) {
    return null;
  }

  const match = label.match(/page\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function buildSectionDrafts(units: SourceUnit[]): StudySectionDraft[] {
  const sections = new Map<number, StudySectionDraft>();

  for (const unit of units) {
    const current = sections.get(unit.sectionIndex);

    if (!current) {
      sections.set(unit.sectionIndex, {
        idx: unit.sectionIndex,
        title: unit.sectionTitle,
        sourceLabel: unit.sourceType === "audio" ? unit.sectionTitle : unit.locatorLabel,
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

  return [...sections.values()].sort((left, right) => left.idx - right.idx);
}

function buildAudioSourceUnits(params: {
  lecture: LectureRow;
  transcript: TranscriptSegmentRow[];
}): SourceUnit[] {
  const units: SourceUnit[] = [];
  let activeSegments: TranscriptSegmentRow[] = [];
  let activeWordCount = 0;

  function flushActiveSegments() {
    if (activeSegments.length === 0) {
      return;
    }

    const text = activeSegments.map((segment) => segment.text).join("\n").trim();
    const startMs = activeSegments[0].start_ms;
    const endMs = activeSegments[activeSegments.length - 1].end_ms;
    const sectionIndex = Math.floor(startMs / AUDIO_SECTION_TARGET_MS);

    units.push({
      lectureId: params.lecture.id,
      unitIndex: units.length,
      sectionIndex,
      sectionTitle: `Minutes ${formatTimestampLabel(sectionIndex * AUDIO_SECTION_TARGET_MS)}-${formatTimestampLabel((sectionIndex + 1) * AUDIO_SECTION_TARGET_MS)}`,
      sourceType: params.lecture.source_type,
      locatorLabel: formatTimestampLabel(startMs),
      startMs,
      endMs,
      pageNumber: null,
      text,
      wordCount: activeWordCount,
      importance: inferImportance(text),
      rawSourceRef: {
        segmentIndexes: activeSegments.map((segment) => segment.idx),
        speakerLabel: activeSegments[0].speaker_label,
      },
    });

    activeSegments = [];
    activeWordCount = 0;
  }

  for (const segment of params.transcript) {
    const segmentWordCount = countWords(segment.text);
    const previous = activeSegments[activeSegments.length - 1] ?? null;
    const speakerChanged =
      previous && previous.speaker_label && segment.speaker_label
        ? previous.speaker_label !== segment.speaker_label
        : false;
    const pauseGap = previous ? segment.start_ms - previous.end_ms : 0;
    const shouldFlush =
      activeSegments.length > 0 &&
      (activeWordCount + segmentWordCount > AUDIO_UNIT_MAX_WORDS ||
        (activeWordCount >= AUDIO_UNIT_TARGET_WORDS && (pauseGap > 8000 || speakerChanged)));

    if (shouldFlush) {
      flushActiveSegments();
    }

    activeSegments.push(segment);
    activeWordCount += segmentWordCount;
  }

  flushActiveSegments();

  return units;
}

function buildDocumentSourceUnits(params: {
  lecture: LectureRow;
  transcript: TranscriptSegmentRow[];
}): SourceUnit[] {
  const units: SourceUnit[] = [];
  let currentSectionLabel: string | null = null;
  let currentSectionIndex = -1;

  for (const segment of params.transcript) {
    const label = normalizeLabel(segment.speaker_label);

    if (currentSectionIndex < 0 || label !== currentSectionLabel) {
      currentSectionLabel = label;
      currentSectionIndex += 1;
    }

    const pageNumber = parsePageNumber(label);
    const sectionTitle =
      label ||
      (params.lecture.source_type === "pdf"
        ? `Page ${pageNumber ?? currentSectionIndex + 1}`
        : `Section ${currentSectionIndex + 1}`);

    units.push({
      lectureId: params.lecture.id,
      unitIndex: units.length,
      sectionIndex: Math.max(currentSectionIndex, 0),
      sectionTitle,
      sourceType: params.lecture.source_type,
      locatorLabel:
        params.lecture.source_type === "pdf"
          ? label || `Page ${pageNumber ?? currentSectionIndex + 1}`
          : label || `Section ${currentSectionIndex + 1}`,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      pageNumber,
      text: segment.text,
      wordCount: countWords(segment.text),
      importance: inferImportance(segment.text),
      rawSourceRef: {
        segmentIndexes: [segment.idx],
        speakerLabel: label,
      },
    });
  }

  return units;
}

export function buildSourceUnits(params: {
  lecture: LectureRow;
  transcript: TranscriptSegmentRow[];
}) {
  const units =
    params.lecture.source_type === "audio"
      ? buildAudioSourceUnits(params)
      : buildDocumentSourceUnits(params);

  return {
    units,
    sections: buildSectionDrafts(units),
  };
}
