import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { normalizeNextPath, sanitizeUserInput } from "@/lib/validation";

type SearchParams = Promise<{
  email?: string;
  mode?: string;
  next?: string;
}>;

export default async function EmailEntryPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await getOptionalUser();
  const params = await searchParams;
  const next = normalizeNextPath(params?.next);
  const mode = params?.mode === "login" ? "login" : "signup";
  const email = typeof params?.email === "string" ? sanitizeUserInput(params.email).slice(0, 320) : "";

  if (user) {
    redirect(next);
  }

  return (
    <main className="landing-shell landing-auth-page email-entry-page">
      <div className="email-entry-topbar">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="app-back-button">
          <ChevronLeft className="h-5 w-5" />
          Back
        </a>
      </div>

      <section className="landing-auth-wrap email-entry-wrap">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="landing-auth-brand email-entry-brand" aria-label={`${BRAND_NAME} home`}>
          <BrandLogo compact imageSizes="(max-width: 768px) 4.6rem, 7rem" priority />
        </a>

        <div className="landing-auth-hero email-entry-copy">
          <h1 className="landing-auth-title email-entry-title">What&apos;s your email?</h1>
          <p className="landing-auth-copy email-entry-text">
            Enter your email address and we&apos;ll send you a verification code.
          </p>
        </div>

        <form action="/auth/email" method="post" className="email-entry-form">
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="next" value={next} />
          <input
            type="email"
            name="email"
            required
            defaultValue={email}
            placeholder="Enter email address"
            autoComplete="email"
            className="email-entry-input"
          />
          <button type="submit" className="email-entry-submit">
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}
