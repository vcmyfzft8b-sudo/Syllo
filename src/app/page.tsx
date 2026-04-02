import Link from "next/link";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

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
    <svg className="auth-provider-icon auth-provider-icon-apple" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.67 12.91c.02 2.29 2 3.05 2.02 3.06-.02.05-.31 1.06-1.03 2.1-.62.89-1.27 1.78-2.29 1.8-1 .02-1.32-.59-2.46-.59-1.15 0-1.5.57-2.44.61-.99.04-1.75-.99-2.37-1.88-1.27-1.83-2.24-5.18-.94-7.44.65-1.12 1.8-1.83 3.06-1.85.95-.02 1.86.64 2.46.64.61 0 1.75-.79 2.95-.67.5.02 1.91.2 2.82 1.53-.08.05-1.69.99-1.68 2.69Zm-2.11-7.29c.52-.63.87-1.5.78-2.37-.75.03-1.65.5-2.18 1.13-.48.56-.9 1.45-.79 2.31.84.07 1.68-.42 2.19-1.07Z"
      />
    </svg>
  );
}

export default async function HomePage() {
  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  const providers = hasPublicSupabaseEnv
    ? await getAuthProviderAvailability()
    : { apple: false, email: false, google: false };

  return (
    <main className="landing-shell landing-auth-page">
      <div className="landing-auth-wrap">
        <Link href="/" className="landing-auth-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo compact imageSizes="(max-width: 768px) 4.6rem, 7rem" priority />
        </Link>

        <section className="landing-auth-hero">
          <h1 className="landing-auth-title">Prijava</h1>
          <p className="landing-auth-copy">
            Prijavi se ali ustvari nov račun.
          </p>
        </section>

        <div className="landing-auth-stack">
          {providers.google ? (
            <form action="/auth/google" method="post" className="auth-provider-form">
              <input type="hidden" name="next" value="/app/start" />
              <button type="submit" className="landing-provider-button primary">
                <GoogleMark />
                <span>Nadaljuj z Google</span>
              </button>
            </form>
          ) : null}

          {providers.apple ? (
            <form action="/auth/apple" method="post" className="auth-provider-form">
              <input type="hidden" name="next" value="/app/start" />
              <button type="submit" className="landing-provider-button secondary">
                <AppleMark />
                <span>Nadaljuj z Apple</span>
              </button>
            </form>
          ) : null}

          {providers.email ? (
            <a
              href="/auth/email-entry?mode=signup&next=%2Fapp%2Fstart"
              className="landing-provider-button tertiary"
            >
              <Mail className="auth-provider-icon" />
              <span>Nadaljuj z e-pošto</span>
            </a>
          ) : null}
        </div>

        <p className="landing-auth-legal">
          Z nadaljevanjem se strinjaš s {`${BRAND_NAME}`}{" "}
          <Link href="/app/support/terms-of-use">pogoji uporabe</Link> in{" "}
          <Link href="/app/support/privacy-policy">politiko zasebnosti</Link>, vključno z AI
          obdelavo zvoka, besedila, dokumentov in povezav, ki jih pošlješ za ustvarjanje
          prepisov, zapiskov, kartic, kvizov in odgovorov v klepetu.
        </p>

        {!hasPublicSupabaseEnv ? (
          <div className="dashboard-surface-card landing-env-warning">
            <p className="ios-info ios-danger">
              Manjkajo javne `Supabase` okoljske spremenljivke. Izpolni `.env.local`.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
