"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { EmojiIcon } from "@/components/emoji-icon";
import { InstantLink } from "@/components/instant-link";
import { BRAND_NAME } from "@/lib/brand";

const TAB_ITEMS = [
  { href: "/app", displayLabel: "Domov", icon: "🏠" },
  { href: "/app/support", displayLabel: "Pomoč", icon: "❓" },
  { href: "/app/settings", displayLabel: "Nastavitve", icon: "⚙️" },
];
const PULL_REFRESH_SPOKES = Array.from({ length: 8 }, (_, index) => index);

function getChrome(pathname: string) {
  if (pathname === "/app/start") {
    return {
      title: "Začni",
      subtitle: "Prilagodi aplikacijo in izberi paket",
      backHref: null,
    };
  }

  if (pathname.startsWith("/app/lectures/")) {
    return {
      title: "Zapisek",
      subtitle: "Preglej in klepetaj o vsebini",
      backHref: "/app",
    };
  }

  if (pathname.startsWith("/app/support/") && pathname !== "/app/support") {
    return {
      title: "Pomoč",
      subtitle: "Vodnik za uporabo",
      backHref: "/app/support",
    };
  }

  if (pathname === "/app/support") {
    return {
      title: "Pomoč",
      subtitle: "Vodniki",
      backHref: null,
    };
  }

  if (pathname === "/app/settings") {
    return {
      title: "Nastavitve",
      subtitle: "Tema in račun",
      backHref: null,
    };
  }

  return {
    title: "Zapiski",
    subtitle: "Celotna knjižnica na enem mestu",
    backHref: null,
  };
}

export function AppShell({
  children,
  hasPaidAccess,
  hasTrialLectureAvailable,
}: {
  children: React.ReactNode;
  hasPaidAccess: boolean;
  hasTrialLectureAvailable: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isMobileDockOpen, setIsMobileDockOpen] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const pullEligibleRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const shouldHideNavigation = pathname === "/app/start";
  const chrome = getChrome(pathname);
  const createHref = "/app?mode=record";
  const subscribeHref = "/app/start";
  const showCreateCta = !shouldHideNavigation;
  const showSubscribeCta = !hasPaidAccess && showCreateCta;
  const subscribeLabel = hasTrialLectureAvailable ? "Trial" : "Naročnina";
  const pullThreshold = 126;
  const cappedPullDistance = Math.min(pullDistance, 180);
  const isLecturePage = pathname.startsWith("/app/lectures/");

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
      setIsPulling(false);
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

    function isInsideMobileSheet(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        Boolean(
          target.closest(
            ".mobile-create-menu, .library-folder-mobile-sheet, .library-folder-modal, .note-read-usage-popover, .dashboard-note-dialog",
          ),
        )
      );
    }

    function handleTouchStart(event: TouchEvent) {
      if (
        window.innerWidth >= mobileBreakpoint ||
        isRefreshing ||
        event.touches.length !== 1 ||
        isInsideMobileSheet(event.target)
      ) {
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
      const nextPullDistance = Math.min(deltaY * 0.5, 180);
      pullDistanceRef.current = nextPullDistance;
      setIsPulling(true);
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
  const pullIndicatorVisible = isRefreshing || cappedPullDistance > 8;
  const mobilePullOffset = isRefreshing ? 54 : Math.round(cappedPullDistance * 0.94);
  const pullIndicatorStyle = {
    opacity: pullIndicatorVisible ? 1 : 0,
    transform: `translate(-50%, ${Math.round(-22 + mobilePullOffset * 0.78)}px) scale(${0.9 + pullProgress * 0.1})`,
  };
  const mobilePullContentStyle = {
    transform:
      mobilePullOffset > 0 ? `translate3d(0, ${mobilePullOffset}px, 0)` : undefined,
    transition: isPulling ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
  };
  const isHomePage = pathname === "/app";
  const mobileDockToggleItem = isHomePage ? TAB_ITEMS[2] : TAB_ITEMS[0];

  function handleMobileDockToggle() {
    if (isMobileDockOpen) {
      setIsMobileDockOpen(false);
      router.push(mobileDockToggleItem.href);
      return;
    }

    setIsMobileDockOpen((current) => !current);
  }

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
        <div className="app-shell-pull-content" style={mobilePullContentStyle}>
          <main className="ios-content app-shell-content app-shell-content-start">{children}</main>
        </div>
      </div>
    );
  }

  return (
    <div className="ios-app-shell desktop-shell">
      {renderPullToRefreshIndicator()}
      <div className="desktop-brandline">
        <InstantLink href="/app" className="desktop-brandline-brand">
          <BrandLogo subtitle="" />
        </InstantLink>

        <div className="desktop-brandline-actions">
          {chrome.backHref ? (
            <InstantLink href={chrome.backHref} className="app-back-button desktop-brandline-back">
              <ChevronLeft className="h-5 w-5" />
              Nazaj
            </InstantLink>
          ) : null}

          {showSubscribeCta ? (
            <InstantLink href={subscribeHref} className="app-subscribe-cta" aria-label={subscribeLabel}>
              <EmojiIcon symbol="✨" />
              <span>{subscribeLabel}</span>
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
            Nov zapisek
            </InstantLink>
          ) : null}

          <nav className="desktop-sidebar-nav" aria-label="Stranska navigacija">
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
        <div className="app-shell-pull-content" style={mobilePullContentStyle}>
          <header className="ios-nav app-topbar">
            <div className="ios-nav-inner app-topbar-inner">
              <InstantLink href="/app" className="app-topbar-brand" aria-label={`Domov ${BRAND_NAME}`}>
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
                    Nazaj
                  </InstantLink>
                </div>
              ) : null}

              {showSubscribeCta ? (
                <div className="ios-nav-actions app-topbar-subscribe-actions">
                  <InstantLink href={subscribeHref} className="app-subscribe-cta" aria-label={subscribeLabel}>
                    <EmojiIcon symbol="✨" />
                    <span>{subscribeLabel}</span>
                  </InstantLink>
                </div>
              ) : null}

              {showCreateCta ? (
                <div className="ios-nav-actions app-topbar-actions">
                  <InstantLink href={createHref} className="app-topbar-cta">
                    <EmojiIcon symbol="➕" size="1rem" />
                    <span>Nov zapisek</span>
                  </InstantLink>
                </div>
              ) : null}
            </div>
          </header>

          <main className="ios-content app-shell-content">{children}</main>
        </div>
      </div>

      <nav
        className={`ios-tabbar ${isMobileDockOpen ? "mobile-open" : "mobile-collapsed"}`}
        aria-label="Glavna navigacija"
      >
        <button
          type="button"
          className="mobile-dock-toggle"
          onClick={handleMobileDockToggle}
          aria-label={
            isMobileDockOpen
              ? `Pojdi na ${mobileDockToggleItem.displayLabel}`
              : "Odpri navigacijo"
          }
          aria-expanded={isMobileDockOpen}
        >
          <EmojiIcon symbol={mobileDockToggleItem.icon} size="1.05rem" />
        </button>
        <div className="ios-tabbar-inner">
          {TAB_ITEMS.map((item) => {
            const active =
              item.href === "/app"
                ? pathname === "/app" || isLecturePage
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <InstantLink
                key={item.href}
                href={item.href}
                className={`ios-tab-item ${active ? "active" : ""} ${
                  item.href === mobileDockToggleItem.href ? "mobile-toggle-item" : ""
                }`}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setIsMobileDockOpen(false);
                  router.push(item.href);
                }}
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
