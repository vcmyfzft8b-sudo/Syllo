import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
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
