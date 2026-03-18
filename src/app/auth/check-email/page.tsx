import Link from "next/link";
import { ChevronLeft, MailCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";

type SearchParams = Promise<{
  email?: string;
  mode?: string;
  next?: string;
}>;

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const email = params?.email ?? "your inbox";
  const mode = params?.mode === "signup" ? "signup" : "login";
  const next = params?.next ?? "/app";

  return (
    <main className="landing-shell auth-shell">
      <header className="ios-nav landing-nav">
        <div className="ios-nav-inner landing-nav-inner">
          <Link href="/" className="landing-brand-link" aria-label="Syllo home">
            <BrandLogo compact />
          </Link>

          <div className="landing-nav-actions">
            <Link href="/" className="app-back-button">
              <ChevronLeft className="h-5 w-5" />
              Back
            </Link>
          </div>
        </div>
      </header>

      <div className="ios-content">
        <section className="auth-stage">
          <div className="auth-panel">
            <div className="auth-check-icon">
              <MailCheck className="h-6 w-6" />
            </div>
            <p className="auth-eyebrow">Check your email</p>
            <h1 className="auth-title">Magic link sent</h1>
            <p className="auth-copy">
              We sent a secure link to <strong>{email}</strong>. Open it on this device to{" "}
              {mode === "signup" ? "finish creating your account" : "sign in"}.
            </p>

            <div className="auth-check-actions">
              <Link
                href={`${mode === "signup" ? "/auth/signup" : "/auth/login"}?next=${encodeURIComponent(
                  next,
                )}&email=${encodeURIComponent(params?.email ?? "")}`}
                className="auth-provider-button"
              >
                Back to form
              </Link>
              <Link href="/auth/login?next=/app" className="auth-secondary-link">
                Use another method
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
