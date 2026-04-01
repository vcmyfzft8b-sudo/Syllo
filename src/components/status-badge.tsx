import type { LectureStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";

const statusMap: Record<
  LectureStatus,
  { label: string; className: string }
> = {
  uploading: {
    label: "Nalaganje",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  queued: {
    label: "V čakalni vrsti",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  transcribing: {
    label: "Prepisovanje",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  generating_notes: {
    label: "Ustvarjanje zapiskov",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  ready: {
    label: "Pripravljeno",
    className: "bg-[var(--green-soft)] text-[var(--green)]",
  },
  failed: {
    label: "Napaka",
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
