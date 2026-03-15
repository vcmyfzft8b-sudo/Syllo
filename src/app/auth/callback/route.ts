import { NextRequest, NextResponse } from "next/server";

import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/app";

  if (!code) {
    const fallbackUrl = request.nextUrl.clone();
    fallbackUrl.pathname = "/auth/error";
    fallbackUrl.search = "";
    fallbackUrl.searchParams.set("message", "Missing authentication code.");
    return NextResponse.redirect(fallbackUrl, { status: 303 });
  }

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

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
