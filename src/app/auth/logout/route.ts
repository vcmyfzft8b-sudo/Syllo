import { NextRequest, NextResponse } from "next/server";

import { isPreviewAuthBypassEnabled } from "@/lib/preview-mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isPreviewAuthBypassEnabled()) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";

    return NextResponse.redirect(url, {
      status: 303,
    });
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = "/";
  // Clear any existing search params
  url.search = "";

  return NextResponse.redirect(url, {
    status: 303,
  });
}
