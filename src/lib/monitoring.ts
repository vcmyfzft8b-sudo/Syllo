import "server-only";

import * as Sentry from "@sentry/nextjs";

type CaptureRouteErrorContext = {
  route: string;
  operation: string;
  request?: Request;
  userId?: string;
  lectureId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export function captureRouteError(
  error: unknown,
  {
    route,
    operation,
    request,
    userId,
    lectureId,
    tags,
    extra,
  }: CaptureRouteErrorContext,
) {
  Sentry.withScope((scope) => {
    scope.setTag("route", route);
    scope.setTag("operation", operation);

    if (lectureId) {
      scope.setTag("lectureId", lectureId);
    }

    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        scope.setTag(key, value);
      }
    }

    if (userId) {
      scope.setUser({ id: userId });
    }

    if (request) {
      scope.setContext("request", {
        method: request.method,
        path: new URL(request.url).pathname,
        vercelRequestId: request.headers.get("x-vercel-id"),
      });
    }

    if (extra) {
      scope.setContext("route", extra);
    }

    Sentry.captureException(toError(error));
  });
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  if (hasMessage(error)) {
    const wrapped = new Error(String(error.message));

    if ("name" in error && typeof error.name === "string") {
      wrapped.name = error.name;
    }

    return wrapped;
  }

  return new Error(typeof error === "string" ? error : "Unknown route error");
}

function hasMessage(error: unknown): error is { message: unknown; name?: unknown } {
  return typeof error === "object" && error !== null && "message" in error;
}
