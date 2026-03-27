import { NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/public-env";

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins() {
  const allowedOrigins = new Set<string>();
  const siteOrigin = normalizeOrigin(getPublicEnv().siteUrl);

  if (siteOrigin) {
    allowedOrigins.add(siteOrigin);
  }

  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://127.0.0.1:3000");
  }

  return allowedOrigins;
}

export function ensureAllowedBrowserOrigin(request: Request) {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin) {
    return null;
  }

  const normalizedOrigin = normalizeOrigin(requestOrigin);

  if (!normalizedOrigin || !getAllowedOrigins().has(normalizedOrigin)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          Vary: "Origin",
        },
      },
    );
  }

  return normalizedOrigin;
}

export function applyCorsHeaders(response: Response, origin: string | null, methods: string) {
  response.headers.set("Vary", "Origin");

  if (!origin) {
    response.headers.delete("Access-Control-Allow-Origin");
    response.headers.delete("Access-Control-Allow-Credentials");
    response.headers.delete("Access-Control-Allow-Methods");
    response.headers.delete("Access-Control-Allow-Headers");
    response.headers.delete("Access-Control-Max-Age");
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", methods);
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Inngest-Signature");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

export function buildCorsPreflightResponse(origin: string | null, methods: string) {
  const response = new NextResponse(null, {
    status: origin ? 204 : 403,
    headers: {
      "Cache-Control": "no-store",
    },
  });

  return applyCorsHeaders(response, origin, methods);
}
