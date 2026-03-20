"use client";

import { CheckCircle2, Sparkles } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

interface StudyCompletionMetric {
  label: string;
  value: string;
}

interface StudyCompletionCardProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  percentage: number;
  percentageLabel: string;
  metrics: StudyCompletionMetric[];
  actions: ReactNode;
}

function completionTone(percentage: number) {
  if (percentage >= 85) {
    return "excellent";
  }

  if (percentage >= 60) {
    return "solid";
  }

  return "progress";
}

export function StudyCompletionCard({
  eyebrow,
  title,
  subtitle,
  percentage,
  percentageLabel,
  metrics,
  actions,
}: StudyCompletionCardProps) {
  const clampedPercentage = Math.max(0, Math.min(100, Math.round(percentage)));
  const tone = completionTone(clampedPercentage);
  const ringStyle: CSSProperties = {
    background: `conic-gradient(var(--completion-accent) ${clampedPercentage}%, color-mix(in srgb, var(--surface-muted) 86%, transparent) ${clampedPercentage}% 100%)`,
  };

  return (
    <div className={`lecture-study-completion lecture-study-completion-${tone}`}>
      <div className="lecture-study-completion-header">
        <span className="lecture-study-completion-badge">
          <Sparkles className="h-4 w-4" />
          {eyebrow}
        </span>
        <div className="lecture-study-completion-copy">
          <h3 className="lecture-study-completion-title">{title}</h3>
          <p className="lecture-study-completion-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="lecture-study-completion-body">
        <div
          className="lecture-study-completion-ring"
          style={ringStyle}
          aria-label={`${clampedPercentage}% ${percentageLabel.toLowerCase()}`}
        >
          <div className="lecture-study-completion-ring-inner">
            <CheckCircle2 className="h-5 w-5" />
            <strong>{clampedPercentage}%</strong>
            <span>{percentageLabel}</span>
          </div>
        </div>

        <div className="lecture-study-completion-metrics">
          {metrics.map((metric) => (
            <div key={metric.label} className="lecture-study-completion-metric">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="lecture-study-complete-actions">{actions}</div>
    </div>
  );
}
