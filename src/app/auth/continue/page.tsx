import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingAuthOptions } from "@/components/landing-auth-options";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

export default async function ContinuePage() {
  const isVercelPreview = process.env.VERCEL_ENV === "preview";

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
          <p className="landing-auth-copy">Prijavi se ali ustvari nov račun.</p>
        </section>

        <LandingAuthOptions providers={providers} next="/app/start" />

        <p className="landing-auth-legal">
          Z nadaljevanjem se strinjaš s {`${BRAND_NAME}`}{" "}
          <Link href="/app/support/terms-of-use">pogoji uporabe</Link> in{" "}
          <Link href="/app/support/privacy-policy">politiko zasebnosti</Link>, vključno z AI
          obdelavo zvoka, besedila, dokumentov in povezav. Potrjuješ tudi, da imaš
          potrebna dovoljenja za snemanje, nalaganje in uporabo gradiva, ki ga pošlješ
          v Memo.
        </p>

        {!hasPublicSupabaseEnv ? (
          <div className="dashboard-surface-card landing-env-warning">
            <p className="ios-info ios-danger">
              {isVercelPreview
                ? "Vercel Preview nima nastavljenih `NEXT_PUBLIC_SUPABASE_URL` in/ali `NEXT_PUBLIC_SUPABASE_ANON_KEY`."
                : "Manjkajo javne `Supabase` okoljske spremenljivke. Izpolni `.env.local`."}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
