import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

const verifyEmailCodeSchema = z.object({
  email: z.string().trim().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, "Enter the verification code from your email."),
  mode: z.enum(["login", "signup"]),
  next: z.string().trim().optional(),
});

function normalizeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/")) {
    return "/app";
  }

  return value;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const parsed = verifyEmailCodeSchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
    mode: formData.get("mode"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set("email", String(formData.get("email") ?? ""));
    retryUrl.searchParams.set("mode", String(formData.get("mode") ?? "login"));
    retryUrl.searchParams.set("next", normalizeNextPath(String(formData.get("next") ?? "/app")));
    retryUrl.searchParams.set(
      "message",
      parsed.error.issues[0]?.message ?? "Enter the verification code from your email.",
    );
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const next = normalizeNextPath(parsed.data.next);
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const verificationType = parsed.data.mode === "signup" ? "signup" : "email";
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: verificationType,
  });

  if (error) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set("email", parsed.data.email);
    retryUrl.searchParams.set("mode", parsed.data.mode);
    retryUrl.searchParams.set("next", next);
    retryUrl.searchParams.set("message", error.message);
    return applyCookies(NextResponse.redirect(retryUrl, { status: 303 }));
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = next;
  successUrl.search = "";
  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}
