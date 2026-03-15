import Link from "next/link";
import {
  ArrowRight,
  FileText,
  Link2,
  MessageSquareText,
  Mic,
  ScrollText,
  Upload,
} from "lucide-react";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { getOptionalUser } from "@/lib/auth";
import { isPreviewAuthBypassEnabled } from "@/lib/preview-mode";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

const INPUTS = [
  {
    title: "Record",
    detail: "Capture live",
    icon: Mic,
    accent: "record",
  },
  {
    title: "Upload",
    detail: "Add audio",
    icon: Upload,
    accent: "default",
  },
  {
    title: "Link",
    detail: "Import a page",
    icon: Link2,
    accent: "default",
  },
  {
    title: "Text or PDF",
    detail: "Paste or upload",
    icon: FileText,
    accent: "default",
  },
] as const;

const OUTPUTS = [
  {
    title: "Transcript",
    detail: "Clean text",
    icon: ScrollText,
  },
  {
    title: "Summary",
    detail: "Structured notes",
    icon: FileText,
  },
  {
    title: "Chat",
    detail: "Ask follow-ups",
    icon: MessageSquareText,
  },
] as const;

export default async function HomePage() {
  const previewAuthBypass = isPreviewAuthBypassEnabled();
  const entryHref = previewAuthBypass ? "/app" : "/auth/login?next=/app";

  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  return (
    <main className="landing-shell">
      <header className="ios-nav landing-nav">
        <div className="ios-nav-inner landing-nav-inner">
          <Link href="/" className="landing-brand-link" aria-label="Syllo home">
            <BrandLogo compact />
          </Link>

          <div className="landing-nav-actions">
            <Link href={entryHref} className="landing-signin-bubble">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <div className="ios-content">
        <div className="home-dashboard landing-dashboard pb-10">
          <section className="dashboard-section landing-hero">
            <div className="landing-hero-copy">
              <h1 className="landing-title">Lecture notes, without the clutter.</h1>
              <p className="landing-lead">
                Record, upload, paste, or link your source. Get transcript, notes, and chat in one workspace.
              </p>
            </div>

            <div className="landing-cta-row">
              <Link href={entryHref} className="landing-cta landing-cta-primary">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#flow" className="landing-cta landing-cta-secondary">
                See how it works
              </a>
            </div>
          </section>

          <section className="dashboard-section" id="flow">
            <div className="dashboard-section-heading">
              <h2 className="dashboard-section-title">Start with</h2>
            </div>

            <div className="note-action-grid">
              {INPUTS.map((item) => (
                <article key={item.title} className="note-action-card landing-feature-card">
                  <span
                    className={`note-action-card-icon ${
                      item.accent === "record" ? "record" : ""
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                  </span>
                  <span className="note-action-card-copy">
                    <span className="note-action-card-label">{item.title}</span>
                    <span className="note-action-card-detail">{item.detail}</span>
                  </span>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-heading">
              <h2 className="dashboard-section-title">Get</h2>
            </div>

            <div className="landing-output-grid">
              {OUTPUTS.map((item) => (
                <article key={item.title} className="dashboard-surface-card landing-output-card">
                  <div className="note-action-card-icon">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div className="landing-output-copy">
                    <p className="landing-output-title">{item.title}</p>
                    <p className="landing-output-detail">{item.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {!hasPublicSupabaseEnv ? (
            <section className="dashboard-section">
              <div className="dashboard-surface-card">
                <p className="ios-info ios-danger">
                  Missing public `Supabase` environment variables. Fill in `.env.local`.
                </p>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
