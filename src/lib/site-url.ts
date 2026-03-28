import type { NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/public-env";

function normalizeOrigin(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveSiteOrigin(request?: NextRequest) {
  const configuredOrigin = normalizeOrigin(getPublicEnv().siteUrl);
  const forwardedProto = request?.headers.get("x-forwarded-proto");
  const forwardedHost = request?.headers.get("x-forwarded-host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const requestOrigin = request?.nextUrl.origin ?? null;

  if (requestOrigin && requestOrigin !== "null") {
    return requestOrigin;
  }

  if (configuredOrigin) {
    return configuredOrigin;
  }

  return "http://localhost:3000";
}

export function resolveSiteUrl(request?: NextRequest) {
  return new URL("/", resolveSiteOrigin(request));
}
