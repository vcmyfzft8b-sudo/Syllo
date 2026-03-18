export const NOTE_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "sl", label: "Slovenian" },
  { value: "de", label: "German" },
  { value: "hr", label: "Croatian" },
  { value: "it", label: "Italian" },
] as const;

const NOTE_LANGUAGE_LABELS = new Map<string, string>(
  NOTE_LANGUAGE_OPTIONS.map((option) => [option.value, option.label]),
);

export function normalizeNoteLanguage(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized && NOTE_LANGUAGE_LABELS.has(normalized) ? normalized : "en";
}

export function resolveNoteLanguageLabel(value?: string | null) {
  return NOTE_LANGUAGE_LABELS.get(normalizeNoteLanguage(value)) ?? "English";
}

export function buildGeneratedContentLanguageInstruction(value?: string | null) {
  const languageCode = normalizeNoteLanguage(value);
  const languageLabel = resolveNoteLanguageLabel(languageCode);

  return `Write all generated study material in ${languageLabel} (language code: ${languageCode}). Translate source content into ${languageLabel} when needed, but preserve technical terms or quoted source wording when that keeps the material more accurate. Do not switch back to English unless the selected language is English.`;
}
