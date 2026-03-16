import { clsx, type ClassValue } from "clsx";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((value) => value.toString().padStart(2, "0"))
      .join(":");
  }

  return [minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function formatLectureDuration(seconds: number | null) {
  if (!seconds) {
    return "Neznano trajanje";
  }

  return formatTimestamp(seconds * 1000);
}

export function formatRelativeDate(isoString: string) {
  return format(new Date(isoString), "d. M. yyyy 'ob' HH:mm");
}

export function formatCalendarDate(isoString: string) {
  return format(new Date(isoString), "d. M. yyyy");
}

export function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export function serializeVector(values: number[]) {
  return `[${values.join(",")}]`;
}

export function safeJsonParse<T>(value: string): T {
  return JSON.parse(stripCodeFences(value)) as T;
}

export function notEmpty<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
