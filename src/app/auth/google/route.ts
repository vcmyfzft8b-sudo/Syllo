import { NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/public-env";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

async function startGoogleAuth(request: NextRequest) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { siteUrl } = getPublicEnv();
  const next = request.nextUrl.searchParams.get("next") ?? "/app";

  const callbackUrl = new URL("/auth/callback", siteUrl);
  callbackUrl.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set(
      "message",
      error?.message ?? "Google sign-in is currently unavailable.",
    );

    return applyCookies(NextResponse.redirect(errorUrl, { status: 303 }));
  }

  return applyCookies(NextResponse.redirect(data.url, { status: 303 }));
}

export async function GET(request: NextRequest) {
  const { siteUrl } = getPublicEnv();
  const loginUrl = new URL("/auth/login", siteUrl);

  const next = request.nextUrl.searchParams.get("next");
  if (next) {
    loginUrl.searchParams.set("next", next);
  }

  return NextResponse.redirect(loginUrl, { status: 303 });
}

export async function POST(request: NextRequest) {
  return startGoogleAuth(request);
}
