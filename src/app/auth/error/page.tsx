import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getPublicEnv } from "@/lib/public-env";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  const { siteUrl } = getPublicEnv();
  const retryAction = new URL("/auth/google", siteUrl);
  retryAction.searchParams.set("next", "/app");

  return (
    <main className="landing-shell">
      <header className="ios-nav">
        <div className="ios-nav-inner">
          <div className="ios-nav-actions">
            <Link href="/" className="app-back-button">
              <ChevronLeft className="h-5 w-5" />
              Back
            </Link>
          </div>
          <div className="ios-nav-meta">
            <div className="ios-nav-title">Sign in</div>
            <div className="ios-nav-caption">Authentication error</div>
          </div>
          <div className="ios-nav-actions" />
        </div>
      </header>

      <div className="ios-content flex items-center justify-center min-h-[70vh]">
        <div className="space-y-6 max-w-lg mx-auto text-center">
          <div className="ios-title-block">
            <p className="ios-section-label tracking-wider uppercase text-[var(--red)] text-xs font-bold mb-2">Error</p>
            <h1 className="text-[2rem] font-bold tracking-[-0.04em] leading-[1.1] mb-4">Google sign-in could not be completed.</h1>
            <p className="ios-subtitle text-[1.1rem]">
              {params.message ??
                "Try again or verify that the OAuth settings are configured correctly."}
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row justify-center mt-6">
            <form action={retryAction.toString()} method="post">
              <button type="submit" className="primary-button sm:w-auto" style={{
                backgroundColor: "var(--label)",
                color: "var(--canvas)",
                minHeight: "3rem",
                fontSize: "1rem"
              }}>
                Try again
              </button>
            </form>
            <Link href="/" className="primary-button sm:w-auto" style={{
              backgroundColor: "var(--surface-muted)",
              color: "var(--label)",
              minHeight: "3rem",
              fontSize: "1rem"
            }}>
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
