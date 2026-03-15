import "server-only";

export function isPreviewAuthBypassEnabled() {
  return process.env.PREVIEW_AUTH_BYPASS === "true";
}
