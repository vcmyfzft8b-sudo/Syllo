import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getOptionalUser } from "@/lib/auth";
import { isPreviewAuthBypassEnabled } from "@/lib/preview-mode";
import { getPublicEnv } from "@/lib/public-env";

type SearchParams = Promise<{
  next?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const previewAuthBypass = isPreviewAuthBypassEnabled();
  const user = await getOptionalUser();
  const next = (await searchParams)?.next;
  const redirectUrl = next ?? "/app";
  const { siteUrl } = getPublicEnv();
  const googleAction = new URL("/auth/google", siteUrl);

  if (next) {
    googleAction.searchParams.set("next", next);
  }

  if (user) {
    redirect(redirectUrl);
  }

  if (previewAuthBypass) {
    redirect(redirectUrl);
  }

  return (
    <main className="landing-shell flex flex-col items-center justify-center min-h-screen bg-[var(--canvas)] p-4">
      <div className="absolute top-0 left-0 w-full p-4 flex items-center">
        <Link href="/" className="app-back-button">
          <ChevronLeft className="h-5 w-5" />
          Back
        </Link>
      </div>

      <div className="w-full max-w-[400px] flex flex-col items-center text-center">
        <h1 className="text-[2rem] font-bold tracking-[-0.04em] mb-2 text-[var(--label)]">
          Welcome
        </h1>
        <p className="text-[1.05rem] text-[var(--secondary-label)] mb-10 leading-[1.4]">
          Sign in to start creating notes in a focused workspace with fewer
          distractions.
        </p>

        <form
          action={googleAction.toString()}
          method="post"
          className="w-full"
        >
          <button
            type="submit"
            className="ios-primary-button w-full"
            style={{
              minHeight: "3.5rem",
              backgroundColor: "var(--surface-solid)",
              color: "var(--label)",
              border: "1px solid var(--separator)",
              boxShadow: "var(--shadow-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem",
              fontSize: "1.05rem",
              fontWeight: 600,
            }}
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
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
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
