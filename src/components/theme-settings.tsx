"use client";

import { useSyncExternalStore } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import type { ThemePreference } from "@/lib/theme";
import {
  applyTheme,
  readStoredThemePreference,
  subscribeToThemePreference,
} from "@/lib/theme";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: string;
}> = [
  {
    value: "system",
    label: "Sistem",
    icon: "💻",
  },
  {
    value: "light",
    label: "Svetla",
    icon: "☀️",
  },
  {
    value: "dark",
    label: "Temna",
    icon: "🌙",
  },
];

export function ThemeSettings() {
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readStoredThemePreference,
    () => "system",
  );

  function updatePreference(next: ThemePreference) {
    if (next === preference) {
      return;
    }

    applyTheme(next);
  }

  return (
    <div className="theme-choice-grid">
      {OPTIONS.map((option) => {
        const active = preference === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => updatePreference(option.value)}
            aria-pressed={active}
            className={`dashboard-link-card settings-link-card theme-choice-card ${active ? "active" : ""}`}
          >
            <span className="note-action-card-icon">
              <EmojiIcon symbol={option.icon} size="1.2rem" />
            </span>
            <span className="note-action-card-copy">
              <span className="note-action-card-label">{option.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
