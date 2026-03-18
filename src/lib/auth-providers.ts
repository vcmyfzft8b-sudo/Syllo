import "server-only";

import { getServerEnv } from "@/lib/server-env";

type SupabaseAuthSettings = {
  external?: Record<string, boolean>;
};

export type AuthProviderAvailability = {
  apple: boolean;
  email: boolean;
  google: boolean;
};

export async function getAuthProviderAvailability(): Promise<AuthProviderAvailability> {
  const env = getServerEnv();

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
      email: true,
      google: true,
    };
  }

  const settings = (await response.json()) as SupabaseAuthSettings;

  return {
    apple: Boolean(settings.external?.apple),
    email: Boolean(settings.external?.email),
    google: Boolean(settings.external?.google),
  };
}
