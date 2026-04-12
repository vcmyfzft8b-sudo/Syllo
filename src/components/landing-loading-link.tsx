"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";

type LandingLoadingLinkProps = {
  children: ReactNode;
  className: string;
  href: string;
};

export function LandingLoadingLink({ children, className, href }: LandingLoadingLinkProps) {
  const [isLoading, setIsLoading] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (isLoading) {
      event.preventDefault();
      return;
    }

    setIsLoading(true);
  }

  return (
    <Link
      href={href}
      className={className}
      aria-busy={isLoading}
      aria-disabled={isLoading}
      onClick={handleClick}
    >
      {isLoading ? <Loader2 className="landing-loading-link-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </Link>
  );
}
