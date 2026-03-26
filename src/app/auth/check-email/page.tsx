import Link from "next/link";
import { ChevronLeft, MailCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { BRAND_NAME } from "@/lib/brand";

type SearchParams = Promise<{
  email?: string;
  message?: string;
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
  const message = params?.message;

  return (
    <main className="landing-shell auth-shell">
      <header className="ios-nav landing-nav">
        <div className="ios-nav-inner landing-nav-inner">
          <Link href="/" className="landing-brand-link" aria-label={`${BRAND_NAME} home`}>
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
            <h1 className="auth-title">Enter your code</h1>
            <p className="auth-copy">
              We sent a verification code to <strong>{email}</strong>. Enter it below to{" "}
              {mode === "signup" ? "finish creating your account" : "sign in"}.
            </p>

            <form action="/auth/email/verify" method="post" className="auth-email-form auth-code-form">
              <input type="hidden" name="email" value={params?.email ?? ""} />
              <input type="hidden" name="mode" value={mode} />
              <input type="hidden" name="next" value={next} />

              <label className="auth-field">
                <input
                  type="text"
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6,8}"
                  minLength={6}
                  maxLength={8}
                  autoComplete="one-time-code"
                  placeholder="Verification code"
                  className="auth-code-input"
                  required
                />
              </label>

              <button type="submit" className="ios-primary-button auth-submit-button">
                {mode === "signup" ? "Create account" : "Verify and sign in"}
              </button>
            </form>

            <p className="auth-helper-copy">
              {message ?? "The code expires automatically. If you didn’t get it, request another one."}
            </p>

            <div className="auth-check-actions">
              <form action="/auth/email" method="post" className="auth-resend-form">
                <input type="hidden" name="email" value={params?.email ?? ""} />
                <input type="hidden" name="mode" value={mode} />
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="auth-provider-button auth-provider-button-submit">
                  Send new code
                </button>
              </form>
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
