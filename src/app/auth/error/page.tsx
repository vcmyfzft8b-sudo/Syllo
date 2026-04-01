import Link from "next/link";
import { AlertCircle, ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { BRAND_NAME } from "@/lib/brand";
import { sanitizeUserInput } from "@/lib/validation";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  const message = typeof params.message === "string"
    ? sanitizeUserInput(params.message).slice(0, 240)
    : undefined;

  return (
    <main className="landing-shell auth-shell">
      <header className="ios-nav landing-nav">
        <div className="ios-nav-inner landing-nav-inner">
          <Link href="/" className="landing-brand-link" aria-label={`Domov ${BRAND_NAME}`}>
            <BrandLogo compact />
          </Link>

          <div className="landing-nav-actions">
            <Link href="/" className="app-back-button">
              <ChevronLeft className="h-5 w-5" />
              Nazaj
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
            <p className="auth-eyebrow">Napaka pri prijavi</p>
            <h1 className="auth-title">Prijava ni uspela</h1>
            <p className="auth-copy">
              {message ??
                "Poskusi drugo metodo prijave ali preveri, ali so ponudniki prijave pravilno nastavljeni."}
            </p>

            <div className="auth-check-actions">
              <Link href="/auth/login?next=/app/start" className="ios-primary-button auth-submit-button">
                Nazaj na prijavo
              </Link>
              <Link href="/auth/signup?next=/app/start" className="auth-secondary-link">
                Ustvari račun
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
