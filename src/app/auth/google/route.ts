import { NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/public-env";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

function resolveNextPath(request: NextRequest, value?: FormDataEntryValue | null) {
  if (typeof value === "string" && value.startsWith("/")) {
    return value;
  }

  const searchNext = request.nextUrl.searchParams.get("next");
  if (searchNext?.startsWith("/")) {
    return searchNext;
  }

  return "/app";
}

async function startGoogleAuth(request: NextRequest, next: string) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { siteUrl } = getPublicEnv();

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
  const limited = await enforceRateLimit({
    request,
    route: "auth:google:get",
    rules: rateLimitPresets.authOAuth,
  });

  if (limited) {
    return limited;
  }

  return startGoogleAuth(request, resolveNextPath(request));
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:google:post",
    rules: rateLimitPresets.authOAuth,
  });

  if (limited) {
    return limited;
  }

  const formData = await request.formData();
  const next = resolveNextPath(request, formData.get("next"));
  return startGoogleAuth(request, next);
}
