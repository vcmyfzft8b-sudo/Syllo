import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { getOptionalUser } from "@/lib/auth";

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
  const next = params?.next?.startsWith("/") ? params.next : "/app";
  const mode = params?.mode === "login" ? "login" : "signup";
  const email = params?.email ?? "";

  if (user) {
    redirect(next);
  }

  return (
    <main className="landing-shell landing-auth-page email-entry-page">
      <div className="email-entry-topbar">
        <Link href="/" className="app-back-button">
          <ChevronLeft className="h-5 w-5" />
          Back
        </Link>
      </div>

      <section className="landing-auth-wrap email-entry-wrap">
        <Link href="/" className="landing-auth-brand email-entry-brand" aria-label="Syllo home">
          <BrandLogo compact />
        </Link>

        <div className="landing-auth-hero email-entry-copy">
          <h1 className="landing-auth-title email-entry-title">What&apos;s your email?</h1>
          <p className="landing-auth-copy email-entry-text">
            Enter your email address and we&apos;ll send you a secure magic link for{" "}
            {mode === "signup" ? "registration" : "password-free login"}.
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
