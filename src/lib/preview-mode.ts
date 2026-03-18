import "server-only";

import { cookies } from "next/headers";

export const PREVIEW_AUTH_BYPASS_DISABLED_COOKIE = "syllo-preview-auth-disabled";

export async function isPreviewAuthBypassEnabled() {
  if (process.env.PREVIEW_AUTH_BYPASS !== "true") {
    return false;
  }

  const cookieStore = await cookies();
  return cookieStore.get(PREVIEW_AUTH_BYPASS_DISABLED_COOKIE)?.value !== "true";
}
