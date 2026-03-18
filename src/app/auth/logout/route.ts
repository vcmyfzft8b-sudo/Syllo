import { NextRequest, NextResponse } from "next/server";

import { PREVIEW_AUTH_BYPASS_DISABLED_COOKIE } from "@/lib/preview-mode";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  await supabase.auth.signOut();

  const response = applyCookies(
    NextResponse.redirect(url, {
      status: 303,
    }),
  );

  response.cookies.set(PREVIEW_AUTH_BYPASS_DISABLED_COOKIE, "true", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
