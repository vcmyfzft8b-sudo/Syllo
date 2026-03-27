import { NextResponse } from "next/server";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: "api:health:get",
    rules: rateLimitPresets.health,
  });

  if (limited) {
    return limited;
  }

  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
