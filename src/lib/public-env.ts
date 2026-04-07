const previewSiteUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? previewSiteUrl ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
} as const;

export const hasPublicSupabaseEnv =
  publicEnv.supabaseUrl.length > 0 && publicEnv.supabaseAnonKey.length > 0;

export function getPublicEnv() {
  return publicEnv;
}
