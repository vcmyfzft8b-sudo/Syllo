"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

type ThemePreference = "system" | "light" | "dark";
const THEME_EVENT = "nota-theme-change";

function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem("nota-theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyTheme(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    localStorage.removeItem("nota-theme");
    window.dispatchEvent(new Event(THEME_EVENT));
    return;
  }

  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = preference;
  localStorage.setItem("nota-theme", preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeToThemePreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === null || event.key === "nota-theme") {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
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
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readStoredThemePreference,
    () => "system",
  );
  const pendingCommitTimerRef = useRef<number | null>(null);
  const queuedPreferenceRef = useRef<ThemePreference | null>(null);

  function clearPendingCommit() {
    if (pendingCommitTimerRef.current !== null) {
      window.clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }

    queuedPreferenceRef.current = null;
  }

  useEffect(() => {
    return () => {
      clearPendingCommit();
    };
  }, []);

  function updatePreference(next: ThemePreference) {
    if (next === preference || queuedPreferenceRef.current === next) {
      return;
    }

    clearPendingCommit();
    queuedPreferenceRef.current = next;

    pendingCommitTimerRef.current = window.setTimeout(() => {
      pendingCommitTimerRef.current = null;
      queuedPreferenceRef.current = null;
      applyTheme(next);
    }, 220);
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
