import Link from "next/link";
import { AlertCircle, ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;

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
            <div className="auth-check-icon error">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="auth-eyebrow">Authentication error</p>
            <h1 className="auth-title">We couldn&apos;t sign you in</h1>
            <p className="auth-copy">
              {params.message ??
                "Try another sign-in method or check that your auth providers are configured correctly."}
            </p>

            <div className="auth-check-actions">
              <Link href="/auth/login?next=/app" className="ios-primary-button auth-submit-button">
                Back to login
              </Link>
              <Link href="/auth/signup?next=/app" className="auth-secondary-link">
                Create account
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
