"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { EmojiIcon } from "@/components/emoji-icon";
import { InstantLink } from "@/components/instant-link";
import { BRAND_NAME } from "@/lib/brand";

const TAB_ITEMS = [
  { href: "/app", displayLabel: "Home", icon: "🏠" },
  { href: "/app/support", displayLabel: "Help", icon: "❓" },
  { href: "/app/settings", displayLabel: "Settings", icon: "⚙️" },
];
const PULL_REFRESH_SPOKES = Array.from({ length: 8 }, (_, index) => index);

function getChrome(pathname: string) {
  if (pathname === "/app/start") {
    return {
      title: "Get Started",
      subtitle: "Personalize the app and choose a plan",
      backHref: null,
    };
  }

  if (pathname.startsWith("/app/lectures/")) {
    return {
      title: "Note",
      subtitle: "Review, export, and chat with the content",
      backHref: "/app",
    };
  }

  if (pathname.startsWith("/app/support/") && pathname !== "/app/support") {
    return {
      title: "Help",
      subtitle: "Usage guide",
      backHref: "/app/support",
    };
  }

  if (pathname === "/app/support") {
    return {
      title: "Help",
      subtitle: "Guides",
      backHref: null,
    };
  }

  if (pathname === "/app/settings") {
    return {
      title: "Settings",
      subtitle: "Theme and account",
      backHref: null,
    };
  }

  return {
    title: "Notes",
    subtitle: "Your full library in one place",
    backHref: null,
  };
}

export function AppShell({
  children,
  canCreateNotes,
}: {
  children: React.ReactNode;
  canCreateNotes: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const pullEligibleRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const shouldHideNavigation = pathname === "/app/start";
  const chrome = getChrome(pathname);
  const createHref = "/app?mode=record";
  const subscribeHref = "/app/start";
  const showCreateCta = !shouldHideNavigation;
  const showSubscribeCta = !canCreateNotes && showCreateCta;
  const pullThreshold = 84;
  const cappedPullDistance = Math.min(pullDistance, 120);

  useEffect(() => {
    for (const item of TAB_ITEMS) {
      router.prefetch(item.href);
    }
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mobileBreakpoint = 1100;

    const resetGesture = () => {
      touchStartYRef.current = null;
      pullEligibleRef.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    function isScrollableAtTop(target: EventTarget | null) {
      let node = target instanceof HTMLElement ? target : null;

      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const canScrollY =
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight;

        if (canScrollY) {
          return node.scrollTop <= 0;
        }

        node = node.parentElement;
      }

      return window.scrollY <= 0;
    }

    function handleTouchStart(event: TouchEvent) {
      if (window.innerWidth >= mobileBreakpoint || isRefreshing || event.touches.length !== 1) {
        resetGesture();
        return;
      }

      touchStartYRef.current = event.touches[0]?.clientY ?? null;
      pullEligibleRef.current = window.scrollY <= 0 && isScrollableAtTop(event.target);
    }

    function handleTouchMove(event: TouchEvent) {
      if (!pullEligibleRef.current || touchStartYRef.current == null || isRefreshing) {
        return;
      }

      if (window.scrollY > 0 || !isScrollableAtTop(event.target)) {
        resetGesture();
        return;
      }

      const deltaY = (event.touches[0]?.clientY ?? 0) - touchStartYRef.current;

      if (deltaY <= 0) {
        setPullDistance(0);
        return;
      }

      event.preventDefault();
      const nextPullDistance = Math.min(deltaY * 0.5, 120);
      pullDistanceRef.current = nextPullDistance;
      setPullDistance(nextPullDistance);
    }

    function handleTouchEnd() {
      if (!pullEligibleRef.current || isRefreshing) {
        resetGesture();
        return;
      }

      const shouldRefresh = pullDistanceRef.current >= pullThreshold;
      resetGesture();

      if (!shouldRefresh) {
        return;
      }

      setIsRefreshing(true);
      startTransition(() => router.refresh());
      window.setTimeout(() => {
        setIsRefreshing(false);
      }, 900);
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isRefreshing, router]);

  const pullProgress = Math.min(cappedPullDistance / pullThreshold, 1);
  const pullIndicatorVisible = isRefreshing || cappedPullDistance > 0;
  const pullIndicatorStyle = {
    opacity: pullIndicatorVisible ? 1 : 0,
    transform: `translate(-50%, ${Math.round(-18 + cappedPullDistance * 0.75)}px) scale(${0.92 + pullProgress * 0.08})`,
  };

  function renderPullToRefreshIndicator() {
    return (
      <div
        className={`pull-refresh-indicator${isRefreshing ? " refreshing" : ""}`}
        style={pullIndicatorStyle}
        aria-hidden={!pullIndicatorVisible}
      >
        <div
          className="pull-refresh-spinner"
          style={{
            transform: isRefreshing
              ? "rotate(0deg)"
              : `rotate(${Math.round(pullProgress * 140)}deg) scale(${0.88 + pullProgress * 0.12})`,
          }}
        >
          {PULL_REFRESH_SPOKES.map((spoke) => (
            <span
              key={spoke}
              className="pull-refresh-spinner-spoke"
              style={
                {
                  "--pull-refresh-spoke-index": spoke,
                  "--pull-refresh-spoke-opacity": 0.12 + pullProgress * 0.7,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>
    );
  }

  if (shouldHideNavigation) {
    return (
      <div className="ios-app-shell">
        {renderPullToRefreshIndicator()}
        <main className="ios-content app-shell-content app-shell-content-start">{children}</main>
      </div>
    );
  }

  return (
    <div className="ios-app-shell desktop-shell">
      {renderPullToRefreshIndicator()}
      <div className="desktop-brandline">
        <InstantLink href="/app" className="desktop-brandline-brand">
          <BrandLogo compact />
        </InstantLink>

        <div className="desktop-brandline-actions">
          {chrome.backHref ? (
            <InstantLink href={chrome.backHref} className="app-back-button desktop-brandline-back">
              <ChevronLeft className="h-5 w-5" />
              Back
            </InstantLink>
          ) : null}

          {showSubscribeCta ? (
            <InstantLink href={subscribeHref} className="app-subscribe-cta">
              <EmojiIcon symbol="✨" size="1rem" />
              <span>Subscribe</span>
            </InstantLink>
          ) : null}
        </div>
      </div>

      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-inner">
          <InstantLink href="/app" className="nota-sidebar-brand">
            <BrandLogo />
          </InstantLink>

          {showCreateCta ? (
            <InstantLink href={createHref} className="nota-sidebar-cta">
              <EmojiIcon symbol="➕" size="1rem" />
              New note
            </InstantLink>
          ) : null}

          <nav className="desktop-sidebar-nav" aria-label="Sidebar navigation">
            {TAB_ITEMS.map((item) => {
              const active =
                item.href === "/app"
                  ? pathname === "/app" || pathname.startsWith("/app/lectures/")
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <InstantLink
                  key={item.href}
                  href={item.href}
                  className={`desktop-sidebar-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="desktop-sidebar-link-icon">
                    <EmojiIcon symbol={item.icon} size="1rem" />
                  </span>
                  <span>{item.displayLabel}</span>
                </InstantLink>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="desktop-main">
        <header className="ios-nav app-topbar">
          <div className="ios-nav-inner app-topbar-inner">
            <InstantLink href="/app" className="app-topbar-brand" aria-label={`${BRAND_NAME} home`}>
              <BrandLogo compact />
            </InstantLink>

            <div className="app-topbar-copy">
              <div className="app-topbar-title">{chrome.title}</div>
              <div className="app-topbar-subtitle">{chrome.subtitle}</div>
            </div>

            {chrome.backHref ? (
              <div className="ios-nav-actions">
                <InstantLink href={chrome.backHref} className="app-back-button">
                  <ChevronLeft className="h-5 w-5" />
                  Back
                </InstantLink>
              </div>
            ) : null}

            {showSubscribeCta ? (
              <div className="ios-nav-actions app-topbar-subscribe-actions">
                <InstantLink href={subscribeHref} className="app-subscribe-cta">
                  <EmojiIcon symbol="✨" size="1rem" />
                  <span>Subscribe</span>
                </InstantLink>
              </div>
            ) : null}

            {showCreateCta ? (
              <div className="ios-nav-actions app-topbar-actions">
                <InstantLink href={createHref} className="app-topbar-cta">
                  <EmojiIcon symbol="➕" size="1rem" />
                  <span>New note</span>
                </InstantLink>
              </div>
            ) : null}
          </div>
        </header>

        <main className="ios-content app-shell-content">{children}</main>
      </div>

      <nav className="ios-tabbar" aria-label="Main navigation">
        <div className="ios-tabbar-inner">
          {TAB_ITEMS.map((item) => {
            const active =
              item.href === "/app"
                ? pathname === "/app" || pathname.startsWith("/app/lectures/")
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <InstantLink
                key={item.href}
                href={item.href}
                className={`ios-tab-item ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="ios-tab-item-icon">
                  <EmojiIcon symbol={item.icon} size="1.05rem" />
                </span>
                <span className="ios-tab-item-label">{item.displayLabel}</span>
              </InstantLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
