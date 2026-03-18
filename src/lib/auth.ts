import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { isPreviewAuthBypassEnabled } from "@/lib/preview-mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getOptionalUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireUser() {
  const user = await getOptionalUser();

  if (!user) {
    if (await isPreviewAuthBypassEnabled()) {
      return {
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        email: "preview@syllo.app",
        app_metadata: {
          provider: "preview",
          providers: ["preview"],
        },
        user_metadata: {
          name: "Preview User",
        },
        identities: [],
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        is_anonymous: false,
      } as User;
    }

    redirect("/");
  }

  return user;
}
