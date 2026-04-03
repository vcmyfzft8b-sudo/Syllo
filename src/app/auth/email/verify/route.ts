import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseFormDataRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import {
  emailAddressSchema,
  nextPathSchema,
  normalizeNextPath,
  sanitizeUserInput,
  verificationCodeSchema,
} from "@/lib/validation";

const VERIFY_EMAIL_FORM_MAX_BYTES = 8 * 1024;

const verifyEmailCodeSchema = z.object({
  email: emailAddressSchema,
  code: verificationCodeSchema,
  mode: z.enum(["login", "signup"]),
  next: nextPathSchema,
});

function getEmailOtpType(mode: "login" | "signup") {
  return mode === "signup" ? "signup" : "email";
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:email:verify:post",
    rules: rateLimitPresets.authVerify,
  });

  if (limited) {
    return limited;
  }

  const parsedFormData = await parseFormDataRequest(request, {
    maxBytes: VERIFY_EMAIL_FORM_MAX_BYTES,
  });

  if (!parsedFormData.success) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set("email", "");
    retryUrl.searchParams.set("mode", "login");
    retryUrl.searchParams.set("next", "/app");
    retryUrl.searchParams.set("messageType", "error");
    retryUrl.searchParams.set("message", "Obrazec je neveljaven ali prevelik.");
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const formData = parsedFormData.data;
  const emailField = formData.get("email");
  const nextField = formData.get("next");
  const parsed = verifyEmailCodeSchema.safeParse({
    email: emailField,
    code: formData.get("code"),
    mode: formData.get("mode"),
    next: nextField,
  });

  if (!parsed.success) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set(
      "email",
      typeof emailField === "string" ? sanitizeUserInput(emailField).slice(0, 320) : "",
    );
    retryUrl.searchParams.set("mode", String(formData.get("mode") ?? "login"));
    retryUrl.searchParams.set(
      "next",
      normalizeNextPath(typeof nextField === "string" ? nextField : null),
    );
    retryUrl.searchParams.set("messageType", "error");
    retryUrl.searchParams.set(
      "message",
      parsed.error.issues[0]?.message ?? "Vnesi potrditveno kodo iz e-pošte.",
    );
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const next = parsed.data.next;
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: getEmailOtpType(parsed.data.mode),
  });

  if (error) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set("email", parsed.data.email);
    retryUrl.searchParams.set("mode", parsed.data.mode);
    retryUrl.searchParams.set("next", next);
    retryUrl.searchParams.set("messageType", "error");
    retryUrl.searchParams.set("message", sanitizeUserInput(error.message).slice(0, 240));
    return applyCookies(NextResponse.redirect(retryUrl, { status: 303 }));
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = next;
  successUrl.search = "";
  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}
