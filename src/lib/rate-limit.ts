import "server-only";

import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RateLimitScope = "ip" | "user" | "user_or_ip";

type RateLimitRule = {
  maxRequests: number;
  windowSeconds: number;
  scope?: RateLimitScope;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  limit_count: number;
  window_seconds: number;
};

export const rateLimitPresets = {
  authEmail: [{ windowSeconds: 600, maxRequests: 12, scope: "ip" }] satisfies RateLimitRule[],
  authVerify: [{ windowSeconds: 600, maxRequests: 30, scope: "ip" }] satisfies RateLimitRule[],
  authOAuth: [{ windowSeconds: 300, maxRequests: 30, scope: "ip" }] satisfies RateLimitRule[],
  authCallback: [{ windowSeconds: 300, maxRequests: 60, scope: "ip" }] satisfies RateLimitRule[],
  authLogout: [{ windowSeconds: 300, maxRequests: 30, scope: "user_or_ip" }] satisfies RateLimitRule[],
  health: [{ windowSeconds: 60, maxRequests: 120, scope: "ip" }] satisfies RateLimitRule[],
  listRead: [{ windowSeconds: 60, maxRequests: 180, scope: "user_or_ip" }] satisfies RateLimitRule[],
  detailRead: [{ windowSeconds: 60, maxRequests: 180, scope: "user_or_ip" }] satisfies RateLimitRule[],
  create: [{ windowSeconds: 600, maxRequests: 24, scope: "user" }] satisfies RateLimitRule[],
  mutate: [{ windowSeconds: 300, maxRequests: 60, scope: "user" }] satisfies RateLimitRule[],
  upload: [{ windowSeconds: 300, maxRequests: 40, scope: "user" }] satisfies RateLimitRule[],
  chat: [{ windowSeconds: 300, maxRequests: 30, scope: "user" }] satisfies RateLimitRule[],
  studySession: [{ windowSeconds: 300, maxRequests: 240, scope: "user" }] satisfies RateLimitRule[],
  progress: [{ windowSeconds: 300, maxRequests: 240, scope: "user" }] satisfies RateLimitRule[],
  internal: [{ windowSeconds: 60, maxRequests: 240, scope: "ip" }] satisfies RateLimitRule[],
  inngest: [{ windowSeconds: 60, maxRequests: 240, scope: "ip" }] satisfies RateLimitRule[],
} as const;

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();

    if (first) {
      return first;
    }
  }

  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("fly-client-ip"),
    request.headers.get("x-vercel-forwarded-for"),
  ];

  return candidates.find((value) => typeof value === "string" && value.length > 0) ?? "unknown";
}

function buildRateKey(params: {
  request: Request;
  userId?: string | null;
  scope: RateLimitScope;
}) {
  const ip = getClientIp(params.request);

  if (params.scope === "ip") {
    return `ip:${ip}`;
  }

  if (params.scope === "user") {
    return params.userId ? `user:${params.userId}` : `ip:${ip}`;
  }

  return params.userId ? `user:${params.userId}` : `ip:${ip}`;
}

export async function enforceRateLimit(params: {
  request: Request;
  route: string;
  rules: RateLimitRule[];
  userId?: string | null;
}) {
  const supabase = createSupabaseServiceRoleClient();

  for (const rule of params.rules) {
    const scope = rule.scope ?? "user_or_ip";
    const rateKey = buildRateKey({
      request: params.request,
      userId: params.userId,
      scope,
    });

    const { data, error } = await supabase.rpc("consume_rate_limit" as never, {
      p_rate_key: rateKey,
      p_route: params.route,
      p_window_seconds: rule.windowSeconds,
      p_max_requests: rule.maxRequests,
    } as never);

    if (error) {
      throw error;
    }

    const result = (Array.isArray(data) ? data[0] : data) as RateLimitResult | null;

    if (!result?.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests.",
          retryAfterSeconds: result?.retry_after_seconds ?? rule.windowSeconds,
        },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(result?.retry_after_seconds ?? rule.windowSeconds),
          },
        },
      );
    }
  }

  return null;
}
