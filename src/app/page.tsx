import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { getOptionalUser } from "@/lib/auth";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

const LANDING_POINTS = [
  "Notes from audio, links, PDFs, or pasted text",
  "Transcript, summary, and structured notes in one place",
  "A focused workflow without extra screens",
];

export default async function HomePage() {
  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  return (
    <main className="landing-shell">
      <header className="ios-nav">
        <div className="ios-nav-inner">
          <div className="ios-nav-meta">
            <div className="ios-nav-title">
              <BrandLogo compact />
            </div>
            <div className="ios-nav-caption">AI notes for lectures</div>
          </div>
          <div className="ios-nav-actions">
            <Link href="/auth/login?next=/app" className="ios-nav-button end">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <div className="ios-content">
        <div className="space-y-6">
          <section className="mb-20 mt-12">
            <div className="landing-grid">
              <div className="space-y-6 max-w-2xl mx-auto text-center">
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--tint-soft)] px-3 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--tint)] mb-4">
                  <Sparkles className="h-3.5 w-3.5" />
                  Focused workflow
                </div>

                <div className="ios-title-block">
                  <h1 className="text-[3.5rem] font-bold tracking-[-0.04em] leading-[1.05] mb-4">
                    Cleaner AI notes for lectures.
                  </h1>
                  <p className="ios-subtitle text-[1.2rem] max-w-xl mx-auto">
                    A minimal space to capture, process, and review course content
                    with a calm, lightweight app feel.
                  </p>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row justify-center mt-6">
                  <Link href="/auth/login?next=/app" className="primary-button sm:w-auto" style={{
                    backgroundColor: "var(--label)",
                    color: "var(--canvas)",
                    padding: "0 2rem",
                    minHeight: "3.5rem",
                    fontSize: "1.05rem"
                  }}>
                    Get started
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="#kaj-dobis" className="primary-button sm:w-auto" style={{
                    backgroundColor: "var(--surface-muted)",
                    color: "var(--label)",
                    padding: "0 2rem",
                    minHeight: "3.5rem",
                    fontSize: "1.05rem"
                  }}>
                    See what you get
                  </Link>
                </div>
              </div>

              <div className="landing-spotlight mt-20 grid sm:grid-cols-2 gap-8 text-left">
                <div className="landing-stat p-6 rounded-[24px]" style={{ backgroundColor: "var(--surface-solid)", border: "1px solid var(--separator)" }}>
                  <p className="ios-section-label">What you get</p>
                  <p className="text-[1.2rem] font-semibold mt-2">Transcript, summary, and chat</p>
                  <p className="ios-row-subtitle mt-2">
                    The key outputs stay together in a single workspace.
                  </p>
                </div>

                <div className="landing-stat p-6 rounded-[24px]" style={{ backgroundColor: "var(--surface-solid)", border: "1px solid var(--separator)" }}>
                  <p className="ios-section-label">Inputs</p>
                  <p className="text-[1.2rem] font-semibold mt-2">Audio, link, PDF, or text</p>
                  <p className="ios-row-subtitle mt-2">
                    Use the source you already have without changing your workflow.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="ios-section" id="kaj-dobis">
            <p className="ios-section-label">What you get</p>
            <div className="ios-group">
              {LANDING_POINTS.map((item) => (
                <div key={item} className="ios-row ios-row-static">
                  <div className="ios-row-icon">
                    <Check className="h-4 w-4 text-[var(--tint)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="ios-row-title">{item}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {!hasPublicSupabaseEnv ? (
            <div className="ios-card">
              <p className="ios-info ios-danger">
                Missing public `Supabase` environment variables. Fill in
                `.env.local` before running locally.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
