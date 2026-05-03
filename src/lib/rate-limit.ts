import "server-only";

import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RateLimitScope = "ip" | "user" | "user_or_ip";

type RateLimitRule = {
  maxRequests: number;
  windowSeconds: number;
  scope?: RateLimitScope;
  storage?: "database" | "memory";
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  limit_count: number;
  window_seconds: number;
};

type AbortableQuery<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => unknown;
};

const RATE_LIMIT_TIMEOUT_MS = 1_200;
const MEMORY_LIMIT_CLEANUP_INTERVAL_MS = 60_000;

type MemoryRateLimitEntry = {
  count: number;
  resetAt: number;
};

const memoryRateLimitBuckets = new Map<string, MemoryRateLimitEntry>();
let lastMemoryLimitCleanupAt = 0;

function buildTimeoutError(timeoutMs: number) {
  const error = new Error(`Rate limit check timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

async function runRateLimitQuery<T>(query: AbortableQuery<T>) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    query.abortSignal?.(controller.signal);

    return await Promise.race([
      Promise.resolve(query),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(buildTimeoutError(RATE_LIMIT_TIMEOUT_MS));
        }, RATE_LIMIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export const rateLimitPresets = {
  authEmail: [{ windowSeconds: 600, maxRequests: 12, scope: "ip" }] satisfies RateLimitRule[],
  authVerify: [{ windowSeconds: 600, maxRequests: 30, scope: "ip" }] satisfies RateLimitRule[],
  authOAuth: [{ windowSeconds: 300, maxRequests: 30, scope: "ip" }] satisfies RateLimitRule[],
  authCallback: [{ windowSeconds: 300, maxRequests: 60, scope: "ip" }] satisfies RateLimitRule[],
  authLogout: [{ windowSeconds: 300, maxRequests: 30, scope: "user_or_ip" }] satisfies RateLimitRule[],
  stripeWebhook: [
    { windowSeconds: 60, maxRequests: 240, scope: "ip" },
    { windowSeconds: 3600, maxRequests: 5000, scope: "ip" },
  ] satisfies RateLimitRule[],
  health: [
    { windowSeconds: 60, maxRequests: 120, scope: "ip", storage: "memory" },
  ] satisfies RateLimitRule[],
  listRead: [
    { windowSeconds: 60, maxRequests: 120, scope: "user_or_ip", storage: "memory" },
  ] satisfies RateLimitRule[],
  detailRead: [
    { windowSeconds: 60, maxRequests: 90, scope: "user_or_ip", storage: "memory" },
  ] satisfies RateLimitRule[],
  create: [{ windowSeconds: 600, maxRequests: 24, scope: "user" }] satisfies RateLimitRule[],
  expensiveCreate: [
    { windowSeconds: 600, maxRequests: 8, scope: "user" },
    { windowSeconds: 3600, maxRequests: 24, scope: "user" },
  ] satisfies RateLimitRule[],
  linkImport: [
    { windowSeconds: 300, maxRequests: 8, scope: "user" },
    { windowSeconds: 3600, maxRequests: 40, scope: "user" },
  ] satisfies RateLimitRule[],
  uploadCreate: [
    { windowSeconds: 600, maxRequests: 10, scope: "user" },
    { windowSeconds: 3600, maxRequests: 30, scope: "user" },
  ] satisfies RateLimitRule[],
  mutate: [{ windowSeconds: 300, maxRequests: 60, scope: "user" }] satisfies RateLimitRule[],
  expensiveMutate: [
    { windowSeconds: 300, maxRequests: 12, scope: "user" },
    { windowSeconds: 3600, maxRequests: 48, scope: "user" },
  ] satisfies RateLimitRule[],
  upload: [{ windowSeconds: 300, maxRequests: 40, scope: "user" }] satisfies RateLimitRule[],
  uploadFinalize: [
    { windowSeconds: 300, maxRequests: 12, scope: "user" },
    { windowSeconds: 3600, maxRequests: 36, scope: "user" },
  ] satisfies RateLimitRule[],
  chunkUpload: [
    { windowSeconds: 300, maxRequests: 20, scope: "user" },
    { windowSeconds: 3600, maxRequests: 80, scope: "user" },
  ] satisfies RateLimitRule[],
  chat: [{ windowSeconds: 300, maxRequests: 30, scope: "user" }] satisfies RateLimitRule[],
  expensiveChat: [
    { windowSeconds: 300, maxRequests: 12, scope: "user" },
    { windowSeconds: 3600, maxRequests: 60, scope: "user" },
  ] satisfies RateLimitRule[],
  studySession: [
    { windowSeconds: 300, maxRequests: 120, scope: "user", storage: "memory" },
  ] satisfies RateLimitRule[],
  progress: [
    { windowSeconds: 300, maxRequests: 120, scope: "user", storage: "memory" },
  ] satisfies RateLimitRule[],
  ttsStatus: [
    { windowSeconds: 60, maxRequests: 60, scope: "user", storage: "memory" },
  ] satisfies RateLimitRule[],
  ttsChunk: [
    { windowSeconds: 300, maxRequests: 20, scope: "user" },
    { windowSeconds: 3600, maxRequests: 120, scope: "user" },
  ] satisfies RateLimitRule[],
  internal: [
    { windowSeconds: 60, maxRequests: 90, scope: "ip" },
    { windowSeconds: 3600, maxRequests: 1500, scope: "ip" },
  ] satisfies RateLimitRule[],
  inngest: [
    { windowSeconds: 60, maxRequests: 120, scope: "ip" },
    { windowSeconds: 3600, maxRequests: 2000, scope: "ip" },
  ] satisfies RateLimitRule[],
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

function cleanupMemoryRateLimitBuckets(now: number) {
  if (now - lastMemoryLimitCleanupAt < MEMORY_LIMIT_CLEANUP_INTERVAL_MS) {
    return;
  }

  lastMemoryLimitCleanupAt = now;

  for (const [key, entry] of memoryRateLimitBuckets.entries()) {
    if (entry.resetAt <= now) {
      memoryRateLimitBuckets.delete(key);
    }
  }
}

function consumeMemoryRateLimit(params: {
  route: string;
  rateKey: string;
  rule: RateLimitRule;
}): RateLimitResult {
  const now = Date.now();
  cleanupMemoryRateLimitBuckets(now);

  const windowMs = Math.max(params.rule.windowSeconds, 1) * 1000;
  const bucketStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = bucketStart + windowMs;
  const bucketKey = [
    params.route,
    params.rateKey,
    params.rule.windowSeconds,
    bucketStart,
  ].join(":");
  const current = memoryRateLimitBuckets.get(bucketKey);
  const nextCount = (current?.count ?? 0) + 1;

  memoryRateLimitBuckets.set(bucketKey, {
    count: nextCount,
    resetAt,
  });

  return {
    allowed: nextCount <= params.rule.maxRequests,
    remaining: Math.max(params.rule.maxRequests - nextCount, 0),
    retry_after_seconds: Math.max(Math.ceil((resetAt - now) / 1000), 1),
    limit_count: params.rule.maxRequests,
    window_seconds: params.rule.windowSeconds,
  };
}

function buildRateLimitedResponse(result: RateLimitResult | null, rule: RateLimitRule) {
  return NextResponse.json(
    {
      error: "Preveč zahtevkov.",
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

export async function enforceRateLimit(params: {
  request: Request;
  route: string;
  rules: RateLimitRule[];
  userId?: string | null;
}) {
  let supabase: ReturnType<typeof createSupabaseServiceRoleClient> | null = null;

  for (const rule of params.rules) {
    const scope = rule.scope ?? "user_or_ip";
    const rateKey = buildRateKey({
      request: params.request,
      userId: params.userId,
      scope,
    });

    if (rule.storage === "memory") {
      const result = consumeMemoryRateLimit({
        route: params.route,
        rateKey,
        rule,
      });

      if (!result.allowed) {
        return buildRateLimitedResponse(result, rule);
      }

      continue;
    }

    supabase ??= createSupabaseServiceRoleClient();

    let rateLimitResponse: Awaited<
      ReturnType<typeof runRateLimitQuery<{
        data: unknown;
        error: unknown;
      }>>
    >;

    try {
      rateLimitResponse = await runRateLimitQuery(
        supabase.rpc("consume_rate_limit" as never, {
          p_rate_key: rateKey,
          p_route: params.route,
          p_window_seconds: rule.windowSeconds,
          p_max_requests: rule.maxRequests,
        } as never),
      );
    } catch (error) {
      console.error("Rate limit check failed; allowing request", {
        route: params.route,
        rateKey,
        rule,
        error,
      });
      return null;
    }

    const { data, error } = rateLimitResponse;

    if (error) {
      console.error("Rate limit check failed; allowing request", {
        route: params.route,
        rateKey,
        rule,
        error,
      });
      return null;
    }

    const result = (Array.isArray(data) ? data[0] : data) as RateLimitResult | null;

    if (!result?.allowed) {
      return buildRateLimitedResponse(result, rule);
    }
  }

  return null;
}
