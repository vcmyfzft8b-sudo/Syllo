import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

const validEmailOtpTypes: EmailOtpType[] = [
  "email",
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
];

function normalizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/")) {
    return "/app";
  }

  return value;
}

function normalizeEmailOtpType(value: string | null): EmailOtpType | null {
  if (!value) {
    return "email";
  }

  return validEmailOtpTypes.includes(value as EmailOtpType)
    ? (value as EmailOtpType)
    : null;
}

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:callback:get",
    rules: rateLimitPresets.authCallback,
  });

  if (limited) {
    return limited;
  }

  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const otpType = normalizeEmailOtpType(request.nextUrl.searchParams.get("type"));
  const authError = request.nextUrl.searchParams.get("error");
  const authErrorCode = request.nextUrl.searchParams.get("error_code");
  const authErrorDescription =
    request.nextUrl.searchParams.get("error_description");
  const next = normalizeNextPath(request.nextUrl.searchParams.get("next"));

  if (!code && !tokenHash) {
    const fallbackUrl = request.nextUrl.clone();
    fallbackUrl.pathname = "/auth/error";
    fallbackUrl.search = "";
    fallbackUrl.searchParams.set(
      "message",
      authErrorDescription ??
        (authErrorCode === "otp_expired"
          ? "This sign-in link has expired. Request a new email and try again."
          : authError
            ? "Authentication was canceled or denied."
            : "Missing authentication code."),
    );
    return NextResponse.redirect(fallbackUrl, { status: 303 });
  }

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : otpType
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: otpType,
        })
      : {
          error: new Error("Invalid email verification type."),
        };

  if (error) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set("message", error.message);
    return applyCookies(NextResponse.redirect(errorUrl, { status: 303 }));
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = next;
  successUrl.search = "";
  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}
