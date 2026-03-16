"use client";

import Link from "next/link";
import {
  ChevronLeft,
  CircleHelp,
  FilePlus2,
  House,
  Settings2,
} from "lucide-react";
import { usePathname } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";

const TAB_ITEMS = [
  { href: "/app", displayLabel: "Home", icon: House },
  { href: "/app/support", displayLabel: "Help", icon: CircleHelp },
  {
    href: "/app/settings",
    displayLabel: "Settings",
    icon: Settings2,
  },
];

function getChrome(pathname: string) {
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
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const chrome = getChrome(pathname);

  return (
    <div className="ios-app-shell desktop-shell">
      <div className="desktop-brandline">
        <Link href="/app" className="desktop-brandline-brand">
          <BrandLogo compact />
        </Link>

        <div className="desktop-brandline-actions">
          {chrome.backHref ? (
            <Link href={chrome.backHref} className="app-back-button desktop-brandline-back">
              <ChevronLeft className="h-5 w-5" />
              Back
            </Link>
          ) : null}
        </div>
      </div>

      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-inner">
          <Link href="/app" className="nota-sidebar-brand">
            <BrandLogo />
          </Link>

          <Link href="/app?mode=record" className="nota-sidebar-cta">
            <FilePlus2 className="h-4 w-4" />
            New note
          </Link>

          <nav className="desktop-sidebar-nav" aria-label="Sidebar navigation">
            {TAB_ITEMS.map((item) => {
              const active =
                item.href === "/app"
                  ? pathname === "/app" || pathname.startsWith("/app/lectures/")
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`desktop-sidebar-link ${active ? "active" : ""}`}
                >
                  <span className="desktop-sidebar-link-icon">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span>{item.displayLabel}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="desktop-main">
        <header className="ios-nav app-topbar">
          <div className="ios-nav-inner app-topbar-inner">
            <Link href="/app" className="app-topbar-brand" aria-label="Syllo home">
              <BrandLogo compact />
            </Link>

            <div className="app-topbar-copy">
              <div className="app-topbar-title">{chrome.title}</div>
              <div className="app-topbar-subtitle">{chrome.subtitle}</div>
            </div>

            {chrome.backHref ? (
              <div className="ios-nav-actions">
                <Link href={chrome.backHref} className="app-back-button">
                  <ChevronLeft className="h-5 w-5" />
                  Back
                </Link>
              </div>
            ) : null}

            <div className="ios-nav-actions app-topbar-actions">
              <Link href="/app?mode=record" className="app-topbar-cta">
                <FilePlus2 className="h-4 w-4" />
                <span>New note</span>
              </Link>
            </div>
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
              <Link
                key={item.href}
                href={item.href}
                className={`ios-tab-item ${active ? "active" : ""}`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.displayLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
