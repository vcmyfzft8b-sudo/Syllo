export type NoteTtsWord = {
  index: number;
  text: string;
};

export type NoteTtsInlineToken =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "word";
      text: string;
      wordIndex: number;
    };

export type NoteTtsBlock = {
  id: string;
  kind: "heading" | "paragraph" | "list_item";
  level?: number;
  tokens: NoteTtsInlineToken[];
};

export type NoteTtsDocument = {
  blocks: NoteTtsBlock[];
  words: NoteTtsWord[];
};

export type NoteTtsChunkPlan = {
  chunkIndex: number;
  wordStartIndex: number;
  wordEndIndex: number;
  text: string;
  estimatedSeconds: number;
};

const DEFAULT_TARGET_WORDS_PER_CHUNK = 190;
const ESTIMATED_TTS_WORDS_PER_SECOND = 2.35;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*/gu;

function normalizeHeadingText(value: string) {
  return value
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripLeadingRedundantHeading(markdown: string, title?: string | null) {
  const lines = markdown.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return markdown;
  }

  const match = lines[firstContentIndex].match(/^#{1,6}\s+(.+)$/);

  if (!match) {
    return markdown;
  }

  const heading = normalizeHeadingText(match[1] ?? "");
  const normalizedTitle = normalizeHeadingText(title ?? "");
  const genericHeadings = new Set(["notes", "lecture notes", "structured notes"]);

  if (!genericHeadings.has(heading) && heading !== normalizedTitle) {
    return markdown;
  }

  const remainingLines = lines.slice(firstContentIndex + 1);

  while (remainingLines[0]?.trim() === "") {
    remainingLines.shift();
  }

  return remainingLines.join("\n").trim();
}

function cleanMarkdownLine(line: string) {
  return line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBlockLine(line: string): {
  kind: NoteTtsBlock["kind"];
  level?: number;
  text: string;
} | null {
  const trimmed = line.trim();

  if (!trimmed || /^[-:| ]+$/.test(trimmed)) {
    return null;
  }

  const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);

  if (heading) {
    return {
      kind: "heading",
      level: heading[1].length,
      text: cleanMarkdownLine(heading[2]),
    };
  }

  const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);

  if (unordered) {
    return {
      kind: "list_item",
      text: cleanMarkdownLine(unordered[1]),
    };
  }

  const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);

  if (ordered) {
    return {
      kind: "list_item",
      text: cleanMarkdownLine(ordered[1]),
    };
  }

  return {
    kind: "paragraph",
    text: cleanMarkdownLine(trimmed.replace(/^>\s?/, "")),
  };
}

function tokenizeLine(text: string, nextWordIndex: number) {
  const tokens: NoteTtsInlineToken[] = [];
  const words: NoteTtsWord[] = [];
  let lastIndex = 0;
  let wordIndex = nextWordIndex;

  for (const match of text.matchAll(WORD_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const word = match[0];

    if (matchIndex > lastIndex) {
      tokens.push({
        type: "text",
        text: text.slice(lastIndex, matchIndex),
      });
    }

    tokens.push({
      type: "word",
      text: word,
      wordIndex,
    });
    words.push({
      index: wordIndex,
      text: word,
    });

    wordIndex += 1;
    lastIndex = matchIndex + word.length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: "text",
      text: text.slice(lastIndex),
    });
  }

  return {
    tokens,
    words,
    nextWordIndex: wordIndex,
  };
}

export function parseNoteTtsDocument(markdown: string): NoteTtsDocument {
  const blocks: NoteTtsBlock[] = [];
  const words: NoteTtsWord[] = [];
  let nextWordIndex = 0;
  let inCodeBlock = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const parsed = parseBlockLine(rawLine);

    if (!parsed?.text) {
      continue;
    }

    const tokenized = tokenizeLine(parsed.text, nextWordIndex);

    if (tokenized.words.length === 0) {
      continue;
    }

    nextWordIndex = tokenized.nextWordIndex;
    words.push(...tokenized.words);
    blocks.push({
      id: `note-tts-block-${blocks.length}`,
      kind: parsed.kind,
      level: parsed.level,
      tokens: tokenized.tokens,
    });
  }

  return { blocks, words };
}

export function buildNoteTtsChunks(
  document: NoteTtsDocument,
  targetWordsPerChunk = DEFAULT_TARGET_WORDS_PER_CHUNK,
): NoteTtsChunkPlan[] {
  const chunks: NoteTtsChunkPlan[] = [];
  const firstBlock = document.blocks[0];
  const secondBlock = document.blocks[1];
  const shouldSkipDuplicatedPageTitle =
    firstBlock?.kind === "heading" &&
    secondBlock?.kind === "heading" &&
    /^\d+[\s.)]/.test(secondBlock.tokens.map((token) => token.text).join("").trim());
  const wordStartOffset = shouldSkipDuplicatedPageTitle
    ? firstBlock.tokens.filter(
        (token): token is Extract<NoteTtsInlineToken, { type: "word" }> =>
          token.type === "word",
      ).length
    : 0;

  for (
    let wordStartIndex = wordStartOffset, chunkIndex = 0;
    wordStartIndex < document.words.length;
    wordStartIndex += targetWordsPerChunk, chunkIndex += 1
  ) {
    const wordEndIndex = Math.min(wordStartIndex + targetWordsPerChunk, document.words.length);
    const chunkWords = document.words.slice(wordStartIndex, wordEndIndex);
    const estimatedSeconds = Math.max(
      1,
      Math.ceil(chunkWords.length / ESTIMATED_TTS_WORDS_PER_SECOND),
    );

    chunks.push({
      chunkIndex,
      wordStartIndex,
      wordEndIndex,
      text: chunkWords.map((word) => word.text).join(" "),
      estimatedSeconds,
    });
  }

  return chunks;
}
