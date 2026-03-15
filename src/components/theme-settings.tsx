"use client";

import { Monitor, Moon, Sun } from "lucide-react";
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
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "system",
    label: "System",
    description: "Follow your device appearance.",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
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
    <div className="p-2">
      <div className="ios-segmented w-full">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => updatePreference(option.value)}
            className={`ios-segment flex-1 ${preference === option.value ? "active" : ""}`}
          >
            <span className="inline-flex items-center gap-2">
              <option.icon className="h-4 w-4" />
              {option.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3">
        {OPTIONS.map((option) => (
          <div
            key={option.value}
            className={`ios-card ${preference === option.value ? "ring-1 ring-[var(--tint)]" : ""}`}
          >
            <div className="flex items-center gap-3">
              <div className="ios-row-icon">
                <option.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="ios-row-title">{option.label}</p>
                <p className="ios-row-subtitle">{option.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
