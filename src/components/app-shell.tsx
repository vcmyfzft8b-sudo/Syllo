"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect } from "react";
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
  const shouldHideNavigation = pathname === "/app/start";
  const chrome = getChrome(pathname);
  const createHref = "/app?mode=record";
  const subscribeHref = "/app/start";
  const showCreateCta = !shouldHideNavigation;
  const showSubscribeCta = !canCreateNotes && showCreateCta;

  useEffect(() => {
    for (const item of TAB_ITEMS) {
      router.prefetch(item.href);
    }
  }, [router]);

  if (shouldHideNavigation) {
    return (
      <div className="ios-app-shell">
        <main className="ios-content app-shell-content app-shell-content-start">{children}</main>
      </div>
    );
  }

  return (
    <div className="ios-app-shell desktop-shell">
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
