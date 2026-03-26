import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { CheckEmailCard } from "@/components/check-email-card";
import { BRAND_NAME } from "@/lib/brand";

type SearchParams = Promise<{
  email?: string;
  message?: string;
  messageType?: string;
  mode?: string;
  next?: string;
  sentAt?: string;
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
  const messageType = params?.messageType === "error" ? "error" : "info";
  const sentAt = Number(params?.sentAt);

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
            <p className="auth-eyebrow">Check your email</p>
            <h1 className="auth-title">Enter your code</h1>
            <p className="auth-copy">
              We sent a verification code to <strong>{email}</strong>. Enter it below to continue.
            </p>
            <CheckEmailCard
              email={params?.email ?? ""}
              mode={mode}
              next={next}
              message={message}
              messageType={messageType}
              sentAt={Number.isFinite(sentAt) ? sentAt : 0}
              cooldownSeconds={60}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
