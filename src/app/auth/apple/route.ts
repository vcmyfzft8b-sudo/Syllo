import { NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/public-env";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

function getNextPath(request: NextRequest, value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/app";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/auth/login";
  loginUrl.search = "";

  const next = request.nextUrl.searchParams.get("next");
  if (next?.startsWith("/")) {
    loginUrl.searchParams.set("next", next);
  }

  return NextResponse.redirect(loginUrl, { status: 303 });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const next = getNextPath(request, formData.get("next"));
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
