import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

export function BrandLogo({
  subtitle = BRAND_TAGLINE,
  compact = false,
}: {
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <span className={`brand-logo ${compact ? "compact" : ""}`}>
      <span className="brand-logo-mark" aria-hidden="true">
        <span className="brand-logo-layer back" />
        <span className="brand-logo-layer front" />
        <span className="brand-logo-accent" />
      </span>
      <span className="brand-logo-copy">
        <strong>{BRAND_NAME}</strong>
        {!compact ? <small>{subtitle}</small> : null}
      </span>
    </span>
  );
}
