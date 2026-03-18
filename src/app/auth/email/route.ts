import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getPublicEnv } from "@/lib/public-env";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

const emailAuthSchema = z.object({
  email: z.string().trim().email(),
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
  const parsed = emailAuthSchema.safeParse({
    email: formData.get("email"),
    mode: formData.get("mode"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set("message", "Enter a valid email address.");
    return NextResponse.redirect(errorUrl, { status: 303 });
  }

  const next = normalizeNextPath(parsed.data.next);
  const { siteUrl } = getPublicEnv();
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const callbackUrl = new URL("/auth/callback", siteUrl);
  callbackUrl.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: parsed.data.mode === "signup",
    },
  });

  if (error) {
    const errorUrl = request.nextUrl.clone();
    errorUrl.pathname = "/auth/error";
    errorUrl.search = "";
    errorUrl.searchParams.set("message", error.message);
    return applyCookies(NextResponse.redirect(errorUrl, { status: 303 }));
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = "/auth/check-email";
  successUrl.search = "";
  successUrl.searchParams.set("email", parsed.data.email);
  successUrl.searchParams.set("mode", parsed.data.mode);
  successUrl.searchParams.set("next", next);

  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}
