import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/public-env";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { siteUrl } = getPublicEnv();

  if (siteUrl) {
    const configuredOrigin = new URL(siteUrl).origin;

    if (request.nextUrl.origin !== configuredOrigin) {
      const redirectUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, siteUrl);
      return NextResponse.redirect(redirectUrl, { status: 307 });
    }
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
