import type { LectureStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";

const statusMap: Record<
  LectureStatus,
  { label: string; className: string }
> = {
  uploading: {
    label: "Uploading",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  queued: {
    label: "Queued",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  transcribing: {
    label: "Transcribing",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  generating_notes: {
    label: "Generating notes",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  ready: {
    label: "Ready",
    className: "bg-[var(--green-soft)] text-[var(--green)]",
  },
  failed: {
    label: "Error",
    className: "bg-[var(--red-soft)] text-[var(--red)]",
  },
};

export function StatusBadge({ status }: { status: LectureStatus }) {
  const config = statusMap[status];

  return (
    <span
      className={cn(
        "ios-status px-2.5 py-1 uppercase tracking-[0.04em]",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
