import { serve } from "inngest/next";
import type { NextRequest } from "next/server";

import { inngest } from "@/inngest/client";
import {
  processLectureFunction,
  processLectureNotesFunction,
  processLectureQuizFunction,
  processLectureStudyFunction,
} from "@/inngest/functions";
import {
  applyCorsHeaders,
  buildCorsPreflightResponse,
  ensureAllowedBrowserOrigin,
} from "@/lib/cors";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";

export const maxDuration = 300;
const INNGEST_ROUTE_METHODS = "GET, POST, PUT, OPTIONS";

const handlers = serve({
  client: inngest,
  functions: [
    processLectureFunction,
    processLectureNotesFunction,
    processLectureStudyFunction,
    processLectureQuizFunction,
  ],
});

function withRestrictedCors(request: NextRequest, response: Response) {
  const allowedOrigin = ensureAllowedBrowserOrigin(request);

  if (allowedOrigin instanceof Response) {
    return allowedOrigin;
  }

  return applyCorsHeaders(response, allowedOrigin, INNGEST_ROUTE_METHODS);
}

export async function GET(request: NextRequest, context: unknown) {
  const limited = await enforceRateLimit({
    request,
    route: "api:inngest:get",
    rules: rateLimitPresets.inngest,
  });

  if (limited) {
    return limited;
  }

  return withRestrictedCors(request, await handlers.GET(request, context as never));
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

  return withRestrictedCors(request, await handlers.POST(request, context as never));
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

  return withRestrictedCors(request, await handlers.PUT(request, context as never));
}

export async function OPTIONS(request: NextRequest) {
  const allowedOrigin = ensureAllowedBrowserOrigin(request);

  if (allowedOrigin instanceof Response) {
    return allowedOrigin;
  }

  return buildCorsPreflightResponse(allowedOrigin, INNGEST_ROUTE_METHODS);
}
