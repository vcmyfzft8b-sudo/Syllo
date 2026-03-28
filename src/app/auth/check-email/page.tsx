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
  const email = normalizedEmail || "your inbox";
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
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="app-back-button">
          <ChevronLeft className="h-5 w-5" />
          Back
        </a>
      </div>

      <section className="landing-auth-wrap check-email-wrap">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="landing-auth-brand check-email-brand" aria-label={`${BRAND_NAME} home`}>
          <BrandLogo compact imageSizes="(max-width: 768px) 4.6rem, 7rem" priority />
        </a>

        <div className="check-email-hero">
          <p className="check-email-eyebrow">Check your email</p>
          <h1 className="check-email-title">Enter your code</h1>
          <p className="check-email-copy">
            We sent a verification code to <strong>{email}</strong>. Enter it below to continue.
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
