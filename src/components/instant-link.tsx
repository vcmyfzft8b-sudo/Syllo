"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import {
  forwardRef,
  useCallback,
  useEffect,
  type AnchorHTMLAttributes,
} from "react";

type InstantLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
  };

export const InstantLink = forwardRef<HTMLAnchorElement, InstantLinkProps>(function InstantLink(
  { href, onClick, onPointerDown, onMouseEnter, onFocus, replace, scroll, prefetch, ...props },
  ref,
) {
  const router = useRouter();

  const prefetchHref = useCallback(() => {
    router.prefetch(href);
  }, [href, router]);

  useEffect(() => {
    prefetchHref();
  }, [prefetchHref]);

  return (
    <Link
      {...props}
      ref={ref}
      href={href}
      replace={replace}
      scroll={scroll}
      prefetch={prefetch ?? true}
      onPointerDown={(event) => {
        prefetchHref();
        onPointerDown?.(event);
      }}
      onMouseEnter={(event) => {
        prefetchHref();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetchHref();
        onFocus?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);
      }}
    />
  );
});
