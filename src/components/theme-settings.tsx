"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

type ThemePreference = "system" | "light" | "dark";

function applyTheme(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    localStorage.removeItem("nota-theme");
    return;
  }

  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = preference;
  localStorage.setItem("nota-theme", preference);
}

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "system",
    label: "System",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    icon: Moon,
  },
];

export function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") {
      return "system";
    }

    const stored = window.localStorage.getItem("nota-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  });

  function updatePreference(next: ThemePreference) {
    setPreference(next);
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
            className={`note-action-card compact-link-card theme-choice-card ${
              active ? "active" : ""
            }`}
          >
            <span className="note-action-card-icon">
              <option.icon className="h-5 w-5" />
            </span>
            <span className="note-action-card-copy">
              <span className="note-action-card-label">{option.label}</span>
            </span>
            <Check
              className={`theme-choice-check h-4 w-4 ${active ? "" : "opacity-0"}`}
            />
          </button>
        );
      })}
    </div>
  );
}
