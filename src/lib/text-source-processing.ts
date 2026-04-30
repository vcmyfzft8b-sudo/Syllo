import type { TranscriptSegmentInput } from "@/lib/types";

export type StructuredSourceBlock = {
  label: string | null;
  pageNumber: number | null;
  text: string;
};

const DOCUMENT_SOURCE_MAX_CHARS = 560;

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function estimateTextSourceDurationSeconds(text: string) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.round(wordCount / 2.6), 1);
}

function splitLongBlock(paragraph: string, maxChars = 850) {
  const normalized = paragraph.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    const words = normalized.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let activeWords: string[] = [];

    for (const word of words) {
      const next = [...activeWords, word].join(" ");
      if (next.length > maxChars && activeWords.length > 0) {
        chunks.push(activeWords.join(" "));
        activeWords = [word];
        continue;
      }

      activeWords.push(word);
    }

    if (activeWords.length > 0) {
      chunks.push(activeWords.join(" "));
    }

    return chunks;
  }

  const chunks: string[] = [];
  let activeChunk = "";

  for (const sentence of sentenceParts) {
    const next = activeChunk ? `${activeChunk} ${sentence}` : sentence;

    if (next.length > maxChars && activeChunk) {
      chunks.push(activeChunk);
      activeChunk = sentence;
      continue;
    }

    activeChunk = next;
  }

  if (activeChunk) {
    chunks.push(activeChunk);
  }

  return chunks;
}

function normalizeStructuredBlocks(blocks: StructuredSourceBlock[]) {
  return blocks.flatMap((block) => {
    const normalizedText = normalizeWhitespace(block.text);
    if (!normalizedText) {
      return [];
    }

    return splitLongBlock(normalizedText, DOCUMENT_SOURCE_MAX_CHARS).map((chunk) => ({
      label: block.label?.trim() || null,
      pageNumber: block.pageNumber ?? null,
      text: chunk,
    }));
  });
}

function buildBlocksFromText(params: {
  text: string;
  sourceType: string;
}) {
  const cleanedText = normalizeWhitespace(params.text);
  const paragraphs = cleanedText
    .split(/\n{2,}|\f+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const blocks: StructuredSourceBlock[] = [];
  let activeSection = `${params.sourceType === "link" ? "Section" : "Section"} 1`;
  let sectionIndex = 1;

  for (const paragraph of paragraphs) {
    const normalized = paragraph.trim();
    if (!normalized) {
      continue;
    }

    const headingLike =
      normalized.length <= 90 &&
      (normalized.startsWith("#") ||
        /^[A-Z][A-Z\s0-9:,-]{5,}$/.test(normalized) ||
        /^\d+(\.\d+)*\s+[A-Z]/.test(normalized));

    if (headingLike) {
      sectionIndex += 1;
      activeSection = normalized.replace(/^#+\s*/, "").trim() || `Section ${sectionIndex}`;
      continue;
    }

    for (const chunk of splitLongBlock(normalized, DOCUMENT_SOURCE_MAX_CHARS)) {
      blocks.push({
        label: activeSection,
        pageNumber: null,
        text: chunk,
      });
    }
  }

  if (blocks.length > 0) {
    return blocks;
  }

  return splitLongBlock(cleanedText, DOCUMENT_SOURCE_MAX_CHARS).map((chunk, index) => ({
    label: `Section ${index + 1}`,
    pageNumber: null,
    text: chunk,
  }));
}

export function buildSyntheticTranscriptFromTextSource(params: {
  text?: string;
  blocks?: StructuredSourceBlock[];
  sourceType: string;
}): TranscriptSegmentInput[] {
  const blocks = params.blocks?.length
    ? normalizeStructuredBlocks(params.blocks)
    : buildBlocksFromText({
        text: params.text ?? "",
        sourceType: params.sourceType,
      });
  const segments: TranscriptSegmentInput[] = [];
  let startMs = 0;
  let elapsedMs = 0;
  const pageLabel = params.sourceType === "presentation" ? "Slide" : "Page";

  for (const block of blocks) {
    const durationMs = Math.max(
      Math.round(block.text.split(/\s+/).filter(Boolean).length * 420),
      6000,
    );

    segments.push({
      idx: segments.length,
      startMs,
      endMs: startMs + durationMs,
      speakerLabel:
        block.pageNumber != null
          ? block.label
            ? `${pageLabel} ${block.pageNumber} · ${block.label}`
            : `${pageLabel} ${block.pageNumber}`
          : block.label,
      text: block.text,
    });

    elapsedMs += durationMs;
    startMs = elapsedMs;
  }

  if (segments.length > 0) {
    return segments;
  }

  const cleanedText = normalizeWhitespace(params.text ?? "");
  if (!cleanedText) {
    return [];
  }

  const fallbackDuration = Math.max(
    Math.round(cleanedText.split(/\s+/).filter(Boolean).length * 420),
    6000,
  );

  return [
    {
      idx: 0,
      startMs: 0,
      endMs: fallbackDuration,
      speakerLabel: null,
      text: cleanedText,
    },
  ];
}
