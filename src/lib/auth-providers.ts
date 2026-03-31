import "server-only";

import { getServerEnv } from "@/lib/server-env";

type SupabaseAuthSettings = {
  email?: boolean | { enabled?: boolean };
  external?: Record<string, boolean>;
};

export type AuthProviderAvailability = {
  apple: boolean;
  email: boolean;
  google: boolean;
};

export async function getAuthProviderAvailability(): Promise<AuthProviderAvailability> {
  const env = getServerEnv();

  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        apple: false,
        email: false,
        google: false,
      };
    }

    const settings = (await response.json()) as SupabaseAuthSettings;
    const emailEnabled =
      typeof settings.email === "boolean"
        ? settings.email
        : typeof settings.email?.enabled === "boolean"
          ? settings.email.enabled
          : typeof settings.external?.email === "boolean"
            ? settings.external.email
            : false;

    return {
      apple: Boolean(settings.external?.apple),
      email: emailEnabled,
      google: Boolean(settings.external?.google),
    };
  } catch {
    return {
      apple: false,
      email: false,
      google: false,
    };
  }
}
