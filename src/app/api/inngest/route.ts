import { serve } from "inngest/next";
import type { NextRequest } from "next/server";

import { inngest } from "@/inngest/client";
import {
  processLectureFunction,
  processLectureQuizFunction,
  processLectureStudyFunction,
} from "@/inngest/functions";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";

export const maxDuration = 300;

const handlers = serve({
  client: inngest,
  functions: [processLectureFunction, processLectureStudyFunction, processLectureQuizFunction],
});

export async function GET(request: NextRequest, context: unknown) {
  const limited = await enforceRateLimit({
    request,
    route: "api:inngest:get",
    rules: rateLimitPresets.inngest,
  });

  if (limited) {
    return limited;
  }

  return handlers.GET(request, context as never);
}

export async function POST(request: NextRequest, context: unknown) {
  const limited = await enforceRateLimit({
    request,
    route: "api:inngest:post",
    rules: rateLimitPresets.inngest,
  });

  if (limited) {
    return limited;
  }

  return handlers.POST(request, context as never);
}

export async function PUT(request: NextRequest, context: unknown) {
  const limited = await enforceRateLimit({
    request,
    route: "api:inngest:put",
    rules: rateLimitPresets.inngest,
  });

  if (limited) {
    return limited;
  }

  return handlers.PUT(request, context as never);
}
