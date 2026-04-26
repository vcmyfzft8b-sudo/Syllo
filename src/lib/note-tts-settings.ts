export const NOTE_TTS_VOICES = [
  "Grace",
  "Maya",
  "Emma",
  "Claire",
  "Nina",
  "Daniel",
  "Adrian",
  "Noah",
] as const;

export type NoteTtsVoice = (typeof NOTE_TTS_VOICES)[number];

export const DEFAULT_NOTE_TTS_VOICE: NoteTtsVoice = "Grace";

export const NOTE_TTS_PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;

export type NoteTtsPlaybackRate = (typeof NOTE_TTS_PLAYBACK_RATES)[number];

export const DEFAULT_NOTE_TTS_PLAYBACK_RATE: NoteTtsPlaybackRate = 1;

export const NOTE_TTS_HIGHLIGHT_COLORS = [
  {
    id: "orange",
    label: "Oranžna",
    readBackground: "#ffedd5",
    readColor: "#7c2d12",
    currentBackground: "#fb923c",
    currentColor: "#431407",
    currentRing: "rgba(251, 146, 60, 0.28)",
  },
  {
    id: "yellow",
    label: "Rumena",
    readBackground: "#fef3c7",
    readColor: "#78350f",
    currentBackground: "#facc15",
    currentColor: "#422006",
    currentRing: "rgba(250, 204, 21, 0.32)",
  },
  {
    id: "green",
    label: "Zelena",
    readBackground: "#dcfce7",
    readColor: "#14532d",
    currentBackground: "#4ade80",
    currentColor: "#052e16",
    currentRing: "rgba(74, 222, 128, 0.28)",
  },
  {
    id: "blue",
    label: "Modra",
    readBackground: "#dbeafe",
    readColor: "#1e3a8a",
    currentBackground: "#60a5fa",
    currentColor: "#0f172a",
    currentRing: "rgba(96, 165, 250, 0.3)",
  },
  {
    id: "pink",
    label: "Roza",
    readBackground: "#fce7f3",
    readColor: "#831843",
    currentBackground: "#f472b6",
    currentColor: "#500724",
    currentRing: "rgba(244, 114, 182, 0.3)",
  },
] as const;

export type NoteTtsHighlightColorId = (typeof NOTE_TTS_HIGHLIGHT_COLORS)[number]["id"];

export const DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID: NoteTtsHighlightColorId = "orange";

