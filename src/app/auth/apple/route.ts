import { NextRequest, NextResponse } from "next/server";

import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { BRAND_NAME } from "@/lib/brand";
import { parseFormDataRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { resolveSiteUrl } from "@/lib/site-url";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { normalizeNextPath, sanitizeUserInput } from "@/lib/validation";

const OAUTH_FORM_MAX_BYTES = 8 * 1024;

function resolveNextPath(request: NextRequest, value?: FormDataEntryValue | null) {
  return normalizeNextPath(
    typeof value === "string" ? value : request.nextUrl.searchParams.get("next"),
  );
}

async function startAppleAuth(request: NextRequest, next: string) {
  const providers = await getAuthProviderAvailability();

  if (!providers.apple) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set("message", sanitizeUserInput(
      `Apple sign-in is not enabled for this ${BRAND_NAME} project yet.`,
    ).slice(0, 240));

    return NextResponse.redirect(errorUrl, { status: 303 });
  }

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();

  const callbackUrl = new URL("/auth/callback", resolveSiteUrl(request));
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
    errorUrl.searchParams.set("message", sanitizeUserInput(
      error?.message ?? "Apple sign-in is currently unavailable.",
    ).slice(0, 240));
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

  const parsedFormData = await parseFormDataRequest(request, {
    maxBytes: OAUTH_FORM_MAX_BYTES,
  });

  if (!parsedFormData.success) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set("message", "Malformed or oversized form submission.");
    return NextResponse.redirect(errorUrl, { status: 303 });
  }

  return startAppleAuth(request, resolveNextPath(request, parsedFormData.data.get("next")));
}
