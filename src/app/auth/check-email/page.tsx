import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { CheckEmailCard } from "@/components/check-email-card";
import { BRAND_NAME } from "@/lib/brand";
import { normalizeNextPath, sanitizeUserInput } from "@/lib/validation";

type SearchParams = Promise<{
  email?: string;
  message?: string;
  messageType?: string;
  mode?: string;
  next?: string;
  sentAt?: string;
  cooldownSeconds?: string;
}>;

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const normalizedEmail = typeof params?.email === "string"
    ? sanitizeUserInput(params.email).slice(0, 320)
    : "";
  const email = normalizedEmail || "tvoj e-naslov";
  const mode = params?.mode === "signup" ? "signup" : "login";
  const next = normalizeNextPath(params?.next);
  const message = typeof params?.message === "string"
    ? sanitizeUserInput(params.message).slice(0, 240)
    : undefined;
  const messageType = params?.messageType === "error" ? "error" : "info";
  const sentAt = Number(params?.sentAt);
  const cooldownSeconds = Number(params?.cooldownSeconds);

  return (
    <main className="landing-shell landing-auth-page check-email-page">
      <div className="check-email-topbar">
        <Link href="/" className="app-back-button">
          <ChevronLeft className="h-5 w-5" />
          Nazaj
        </Link>
      </div>

      <section className="landing-auth-wrap check-email-wrap">
        <Link href="/" className="landing-auth-brand check-email-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo compact imageSizes="(max-width: 768px) 4.6rem, 7rem" priority />
        </Link>

        <div className="check-email-hero">
          <p className="check-email-eyebrow">Preveri e-pošto</p>
          <h1 className="check-email-title">Vnesi kodo</h1>
          <p className="check-email-copy">
            Na <strong>{email}</strong> smo poslali potrditveno kodo. Vnesi jo spodaj za nadaljevanje.
          </p>
        </div>

        <CheckEmailCard
          email={normalizedEmail}
          mode={mode}
          next={next}
          message={message}
          messageType={messageType}
          sentAt={Number.isFinite(sentAt) ? sentAt : 0}
          cooldownSeconds={Number.isFinite(cooldownSeconds) ? cooldownSeconds : 60}
        />
      </section>
    </main>
  );
}
