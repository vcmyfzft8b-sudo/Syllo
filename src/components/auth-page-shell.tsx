import Link from "next/link";
import { ChevronLeft, Mail } from "lucide-react";
import type { ReactNode } from "react";

import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND_NAME } from "@/lib/brand";

type AuthMode = "login" | "signup";

function GoogleMark() {
  return (
    <svg className="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg className="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.67 12.91c.02 2.29 2 3.05 2.02 3.06-.02.05-.31 1.06-1.03 2.1-.62.89-1.27 1.78-2.29 1.8-1 .02-1.32-.59-2.46-.59-1.15 0-1.5.57-2.44.61-.99.04-1.75-.99-2.37-1.88-1.27-1.83-2.24-5.18-.94-7.44.65-1.12 1.8-1.83 3.06-1.85.95-.02 1.86.64 2.46.64.61 0 1.75-.79 2.95-.67.5.02 1.91.2 2.82 1.53-.08.05-1.69.99-1.68 2.69Zm-2.11-7.29c.52-.63.87-1.5.78-2.37-.75.03-1.65.5-2.18 1.13-.48.56-.9 1.45-.79 2.31.84.07 1.68-.42 2.19-1.07Z"
      />
    </svg>
  );
}

function AuthProviderButton(props: {
  href: string;
  label: string;
  mark: ReactNode;
}) {
  return (
    <a href={props.href} className="auth-provider-button">
      {props.mark}
      <span>{props.label}</span>
    </a>
  );
}

export async function AuthPageShell(props: {
  mode: AuthMode;
  next: string;
  prefilledEmail?: string;
}) {
  const providers = await getAuthProviderAvailability();
  const loginMode = props.mode === "login";
  const title = loginMode ? "Welcome back" : "Create your account";
  const copy = loginMode
    ? "Pick up where you left off with transcript, notes, flashcards, and chat."
    : "Start with one lecture and get transcript, summary, flashcards, and chat in one workspace.";
  const googleLabel = loginMode ? "Sign in with Google" : "Create account with Google";
  const appleLabel = loginMode ? "Sign in with Apple" : "Create account with Apple";
  const emailLabel = loginMode ? "Email me a sign-in link" : "Email me a sign-up link";
  const switchHref = loginMode ? "/auth/signup" : "/auth/login";
  const switchLabel = loginMode ? "Create account" : "Log in";
  const switchCopy = loginMode ? "New here?" : "Already have an account?";

  return (
    <main className="landing-shell auth-shell">
      <header className="ios-nav landing-nav">
        <div className="ios-nav-inner landing-nav-inner">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="landing-brand-link" aria-label={`${BRAND_NAME} home`}>
            <BrandLogo compact />
          </a>

          <div className="landing-nav-actions">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="app-back-button">
              <ChevronLeft className="h-5 w-5" />
              Back
            </a>
          </div>
        </div>
      </header>

      <div className="ios-content">
        <section className="auth-stage">
          <div className="auth-panel">
            <p className="auth-eyebrow">{loginMode ? "Log in" : "Sign up"}</p>
            <h1 className="auth-title">{title}</h1>
            <p className="auth-copy">{copy}</p>

            <div className="auth-provider-stack">
              {providers.apple ? (
                <AuthProviderButton
                  href={`/auth/apple?next=${encodeURIComponent(props.next)}`}
                  label={appleLabel}
                  mark={<AppleMark />}
                />
              ) : null}
              {providers.google ? (
                <AuthProviderButton
                  href={`/auth/google?next=${encodeURIComponent(props.next)}`}
                  label={googleLabel}
                  mark={<GoogleMark />}
                />
              ) : null}
            </div>

            {providers.email ? (
              <>
                <div className="auth-divider">
                  <span>or</span>
                </div>

                <form action="/auth/email" method="post" className="auth-email-form">
                  <input type="hidden" name="mode" value={props.mode} />
                  <input type="hidden" name="next" value={props.next} />

                  <label className="auth-field">
                    <Mail className="auth-field-icon h-5 w-5" />
                    <input
                      type="email"
                      name="email"
                      required
                      defaultValue={props.prefilledEmail}
                      placeholder="Enter your email"
                      autoComplete="email"
                    />
                  </label>

                  <button type="submit" className="ios-primary-button auth-submit-button">
                    {emailLabel}
                  </button>
                </form>

                <p className="auth-helper-copy">
                  We&apos;ll send a verification code to your inbox.
                </p>
              </>
            ) : null}

            <p className="auth-legal-copy">
              By continuing, you agree to {`${BRAND_NAME}'s`}{" "}
              <Link href="/app/support/terms-of-use">Terms of use</Link> and{" "}
              <Link href="/app/support/privacy-policy">Privacy policy</Link>, including
              processing the audio, text, documents, and links you submit with AI providers
              to generate transcripts, notes, flashcards, quizzes, and chat responses.
            </p>

            <p className="auth-switch-copy">
              {switchCopy}{" "}
              <a href={`${switchHref}?next=${encodeURIComponent(props.next)}`}>
                {switchLabel}
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
