import "server-only";

import { getPublicEnv } from "@/lib/public-env";

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
  const env = getPublicEnv();
  const apiKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.supabaseUrl || !apiKey) {
    return {
      apple: false,
      email: false,
      google: false,
    };
  }

  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
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
