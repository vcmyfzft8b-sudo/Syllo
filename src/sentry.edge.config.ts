import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDevelopment = process.env.NODE_ENV === "development";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: isDevelopment ? 1.0 : 0.1,
  enableLogs: true,
});
