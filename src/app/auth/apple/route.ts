import { NextRequest, NextResponse } from "next/server";

import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { BRAND_NAME } from "@/lib/brand";
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

async function startAppleAuth(request: NextRequest, next: string) {
  const providers = await getAuthProviderAvailability();

  if (!providers.apple) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set(
      "message",
      `Apple sign-in is not enabled for this ${BRAND_NAME} project yet.`,
    );

    return NextResponse.redirect(errorUrl, { status: 303 });
  }

  const { siteUrl } = getPublicEnv();
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();

  const callbackUrl = new URL("/auth/callback", siteUrl);
  callbackUrl.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });

  if (error || !data.url) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set(
      "message",
      error?.message ?? "Apple sign-in is currently unavailable.",
    );
    return applyCookies(NextResponse.redirect(errorUrl, { status: 303 }));
  }

  return applyCookies(NextResponse.redirect(data.url, { status: 303 }));
}

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:apple:get",
    rules: rateLimitPresets.authOAuth,
  });

  if (limited) {
    return limited;
  }

  return startAppleAuth(request, resolveNextPath(request));
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:apple:post",
    rules: rateLimitPresets.authOAuth,
  });

  if (limited) {
    return limited;
  }

  const formData = await request.formData();
  return startAppleAuth(request, resolveNextPath(request, formData.get("next")));
}
