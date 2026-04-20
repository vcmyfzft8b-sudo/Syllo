import Image from "next/image";

import { BRAND_TAGLINE, SEO_BRAND_NAME } from "@/lib/brand";

export function BrandLogo({
  subtitle = BRAND_TAGLINE,
  compact = false,
  imageSizes,
  priority = false,
}: {
  subtitle?: string;
  compact?: boolean;
  imageSizes?: string;
  priority?: boolean;
}) {
  return (
    <span className={`brand-logo ${compact ? "compact" : ""}`}>
      <span className="brand-logo-mark" aria-hidden="true">
        <Image
          src="/memo-logo.png"
          alt=""
          width={3651}
          height={3285}
          className="brand-logo-image"
          sizes={imageSizes ?? (compact ? "2.2rem" : "2.55rem")}
          priority={priority}
        />
      </span>
      <span className="brand-logo-copy">
        <strong>{SEO_BRAND_NAME}</strong>
        {!compact ? <small>{subtitle}</small> : null}
      </span>
    </span>
  );
}
