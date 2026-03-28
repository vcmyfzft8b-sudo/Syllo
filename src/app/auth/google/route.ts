import { NextRequest, NextResponse } from "next/server";

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

async function startGoogleAuth(request: NextRequest, next: string) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();

  const callbackUrl = new URL("/auth/callback", resolveSiteUrl(request));
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
    errorUrl.searchParams.set("message", sanitizeUserInput(
      error?.message ?? "Google sign-in is currently unavailable.",
    ).slice(0, 240));

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

  const next = resolveNextPath(request, parsedFormData.data.get("next"));
  return startGoogleAuth(request, next);
}
