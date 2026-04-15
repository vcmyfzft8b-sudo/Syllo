import "server-only";

export const MIN_CONCEPT_QUALITY_SCORE = 6;

const MISSING_CONTEXT_PATTERNS = [
  /\bthe lecture\b/i,
  /\bthe notes\b/i,
  /\bthe source material\b/i,
  /\bthe source\b/i,
  /\bthe text above\b/i,
  /\bthe text below\b/i,
  /\bthe table above\b/i,
  /\bthe table below\b/i,
  /\bthe figure above\b/i,
  /\bthe figure below\b/i,
  /\bthe diagram above\b/i,
  /\bthe diagram below\b/i,
  /\bthe illustration above\b/i,
  /\bas shown\b/i,
  /\bas illustrated\b/i,
  /\bas depicted\b/i,
  /\bshown in the\b/i,
  /\bdepicted in the\b/i,
  /\baccording to the source\b/i,
  /\bbased on the source\b/i,
  /\baccording to the material\b/i,
  /\bbased on the material\b/i,
  /\bin the material\b/i,
  /\bin the lecture\b/i,
  /\bin the notes\b/i,
  /\bwhat (?:does|did|is|are).*\b(?:material|lecture|source|text|image|figure|diagram|table|example)\b/i,
  /\bv\s+predavanj[ueiuom]?\b/i,
  /\bpo\s+predavanj[ueiuom]?\b/i,
  /\bv\s+zapisk(?:ih|u|om|a|ih)?\b/i,
  /\bpo\s+zapisk(?:ih|u|om|a|ih)?\b/i,
  /\bv\s+gradiv[auoem]?\b/i,
  /\bpo\s+gradiv[auoem]?\b/i,
  /\bglede na\s+gradiv[aoeuim]?\b/i,
  /\bglede na\s+vir\b/i,
  /\bna\s+slik[ie]\b/i,
  /\bv\s+slik[ie]\b/i,
  /\bna\s+tabel[ie]\b/i,
  /\bv\s+tabel[ie]\b/i,
  /\bna\s+diagramu\b/i,
  /\bv\s+diagramu\b/i,
  /\bna\s+grafu\b/i,
  /\bv\s+grafu\b/i,
  /\bv\s+ilustracij[ie]\b/i,
  /\bna\s+ilustracij[ie]\b/i,
  /\bzgoraj\b/i,
  /\bspodaj\b/i,
  /\bkot je prikazano\b/i,
  /\bkot je ponazorjeno\b/i,
  /\bv prikazu\b/i,
  /\bv ilustraciji\b/i,
];

const VAGUE_REFERENCE_PATTERNS = [
  /^(?:what|which|why|how)\s+(?:is|are|does|do|can|should|would)?\s*(?:this|that|it|these|those)\b/i,
  /^(?:explain|describe|define)\s+(?:this|that|it|these|those)\b/i,
  /^(?:kaj|kateri|katera|katero|zakaj|kako)\s+(?:je|so|pomeni|pomenijo)?\s*(?:to|ta|te|ti|tisto)\b/i,
  /^(?:pojasni|opiši|definiraj)\s+(?:to|ta|te|ti|tisto)\b/i,
];

const WEAK_GENERIC_PATTERNS = [
  /\b(?:what|which)\s+(?:is|are)\s+(?:the\s+)?(?:main|important|key)\s+(?:thing|point|idea|topic)\b/i,
  /\b(?:what|which)\s+(?:is|are)\s+mentioned\b/i,
  /\b(?:kaj|kateri|katera|katero)\s+(?:je|so)\s+(?:glavn[aioue]|pomembn[aioue]|ključn[aioue])\s+(?:stvar|točka|ideja|tema)\b/i,
  /\b(?:kaj|kateri|katera|katero)\s+(?:je|so)\s+omenjen[oaie]?\b/i,
];

const BAD_OPTION_PATTERNS = [
  /\ball of the above\b/i,
  /\bnone of the above\b/i,
  /\bvse navedeno\b/i,
  /\bnič od navedenega\b/i,
  /\bnobena od navedenih\b/i,
];

export function normalizeStudyQualityText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStudyQualityKey(value: string) {
  return normalizeStudyQualityText(value)
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9ščžćđ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dependsOnMissingStudyContext(value: string) {
  return MISSING_CONTEXT_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasVagueStandaloneReference(value: string) {
  return VAGUE_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalizeStudyQualityText(value)));
}

export function hasWeakGenericStudyShape(value: string) {
  return WEAK_GENERIC_PATTERNS.some((pattern) => pattern.test(value));
}

export function isHighQualityStudyPrompt(value: string) {
  const normalized = normalizeStudyQualityText(value);

  return (
    normalized.length >= 6 &&
    !dependsOnMissingStudyContext(normalized) &&
    !hasVagueStandaloneReference(normalized) &&
    !hasWeakGenericStudyShape(normalized)
  );
}

export function areHighQualityQuizOptions(options: string[]) {
  const normalizedOptions = options.map(normalizeStudyQualityText);

  if (normalizedOptions.length !== 4) {
    return false;
  }

  if (normalizedOptions.some((option) => option.length === 0)) {
    return false;
  }

  if (normalizedOptions.some((option) => BAD_OPTION_PATTERNS.some((pattern) => pattern.test(option)))) {
    return false;
  }

  return new Set(normalizedOptions.map(normalizeStudyQualityKey)).size === normalizedOptions.length;
}

export function isHighQualityFlashcard(front: string, back: string) {
  const normalizedBack = normalizeStudyQualityText(back);

  return (
    isHighQualityStudyPrompt(front) &&
    normalizedBack.length > 0 &&
    normalizeStudyQualityKey(front) !== normalizeStudyQualityKey(normalizedBack)
  );
}
