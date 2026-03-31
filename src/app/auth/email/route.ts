import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { parseFormDataRequest } from "@/lib/request-validation";
import {
  createSupabaseRouteHandlerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  emailAddressSchema,
  nextPathSchema,
  normalizeNextPath,
  sanitizeUserInput,
} from "@/lib/validation";

const EMAIL_AUTH_MINUTE_LIMIT_SECONDS = 60;
const EMAIL_AUTH_HOURLY_LIMIT = 10;
const EMAIL_AUTH_HOURLY_LIMIT_SECONDS = 60 * 60;
const EMAIL_AUTH_FORM_MAX_BYTES = 8 * 1024;

const emailAuthSchema = z.object({
  email: emailAddressSchema,
  mode: z.enum(["login", "signup"]),
  next: nextPathSchema,
});

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function redirectToCheckEmail(
  request: NextRequest,
  options: {
    email: string;
    mode: "login" | "signup";
    next: string;
    message?: string;
    messageType?: "error" | "info";
    sentAt?: number;
    cooldownSeconds?: number;
  },
) {
  const successUrl = request.nextUrl.clone();
  successUrl.pathname = "/auth/check-email";
  successUrl.search = "";
  successUrl.searchParams.set("email", options.email);
  successUrl.searchParams.set("mode", options.mode);
  successUrl.searchParams.set("next", options.next);
  successUrl.searchParams.set("sentAt", String(options.sentAt ?? Date.now()));
  successUrl.searchParams.set(
    "cooldownSeconds",
    String(options.cooldownSeconds ?? EMAIL_AUTH_MINUTE_LIMIT_SECONDS),
  );

  if (options.message) {
    successUrl.searchParams.set("message", sanitizeUserInput(options.message).slice(0, 240));
  }

  if (options.messageType) {
    successUrl.searchParams.set("messageType", options.messageType);
  }

  return successUrl;
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:email:post",
    rules: rateLimitPresets.authEmail,
  });

  if (limited) {
    return limited;
  }

  const parsedFormData = await parseFormDataRequest(request, {
    maxBytes: EMAIL_AUTH_FORM_MAX_BYTES,
  });

  if (!parsedFormData.success) {
    const retryUrl = redirectToCheckEmail(request, {
      email: "",
      mode: "login",
      next: "/app",
      message: "Malformed or oversized form submission.",
      messageType: "error",
      sentAt: 0,
    });
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const formData = parsedFormData.data;
  const nextField = formData.get("next");
  const parsed = emailAuthSchema.safeParse({
    email: formData.get("email"),
    mode: formData.get("mode"),
    next: nextField,
  });

  if (!parsed.success) {
    const retryUrl = redirectToCheckEmail(request, {
      email: String(formData.get("email") ?? ""),
      mode: formData.get("mode") === "signup" ? "signup" : "login",
      next: normalizeNextPath(typeof nextField === "string" ? nextField : null),
      message: "Enter a valid email address.",
      messageType: "error",
      sentAt: 0,
    });
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const next = parsed.data.next;
  const normalizedEmail = normalizeEmail(parsed.data.email);
  const providers = await getAuthProviderAvailability();

  if (!providers.email) {
    const retryUrl = redirectToCheckEmail(request, {
      email: parsed.data.email,
      mode: parsed.data.mode,
      next,
      message: "Email sign-in is not enabled for this project.",
      messageType: "error",
      sentAt: 0,
    });
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const serviceRole = createSupabaseServiceRoleClient();

  const oneMinuteAgo = new Date(Date.now() - EMAIL_AUTH_MINUTE_LIMIT_SECONDS * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - EMAIL_AUTH_HOURLY_LIMIT_SECONDS * 1000).toISOString();

  const [recentMinuteResult, recentHourResult] = await Promise.all([
    serviceRole
      .from("email_auth_requests")
      .select("created_at")
      .eq("email", normalizedEmail)
      .gte("created_at", oneMinuteAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceRole
      .from("email_auth_requests")
      .select("created_at")
      .eq("email", normalizedEmail)
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: true }),
  ]);

  const recentMinuteError = recentMinuteResult.error;
  const recentHourError = recentHourResult.error;
  const recentMinuteRequest = recentMinuteResult.data as { created_at: string } | null;
  const recentHourRequests = (recentHourResult.data ?? []) as Array<{ created_at: string }>;

  if (recentMinuteError || recentHourError) {
    const retryUrl = redirectToCheckEmail(request, {
      email: parsed.data.email,
      mode: parsed.data.mode,
      next,
      message: "We couldn’t check the email send limit. Try again.",
      messageType: "error",
      sentAt: 0,
    });
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  if (recentMinuteRequest?.created_at) {
    const retryUrl = redirectToCheckEmail(request, {
      email: parsed.data.email,
      mode: parsed.data.mode,
      next,
      message: "You can request another code once the 1-minute timer ends.",
      messageType: "error",
      sentAt: new Date(recentMinuteRequest.created_at).getTime(),
      cooldownSeconds: EMAIL_AUTH_MINUTE_LIMIT_SECONDS,
    });
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  if ((recentHourRequests?.length ?? 0) >= EMAIL_AUTH_HOURLY_LIMIT) {
    const oldestAllowedRequest = recentHourRequests?.[0]?.created_at;
    const oldestAllowedTime = oldestAllowedRequest
      ? new Date(oldestAllowedRequest).getTime()
      : Date.now();

    const retryUrl = redirectToCheckEmail(request, {
      email: parsed.data.email,
      mode: parsed.data.mode,
      next,
      message: "This email has requested too many codes recently. Try again when the timer ends.",
      messageType: "error",
      sentAt: oldestAllowedTime,
      cooldownSeconds: EMAIL_AUTH_HOURLY_LIMIT_SECONDS,
    });
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: parsed.data.mode === "signup",
    },
  });

  if (error) {
    const retryUrl = redirectToCheckEmail(request, {
      email: parsed.data.email,
      mode: parsed.data.mode,
      next,
      message: error.message,
      messageType: "error",
      sentAt: 0,
    });
    return applyCookies(NextResponse.redirect(retryUrl, { status: 303 }));
  }

  const emailAuthRequestTable = serviceRole.from("email_auth_requests" as never) as unknown as {
    insert: (value: { email: string }[]) => Promise<{ error: { message: string } | null }>;
  };

  const { error: insertError } = await emailAuthRequestTable.insert([
    { email: normalizedEmail },
  ]);

  if (insertError) {
    const retryUrl = redirectToCheckEmail(request, {
      email: parsed.data.email,
      mode: parsed.data.mode,
      next,
      message: "We sent the code, but couldn’t update the resend timer. Wait a minute before trying again.",
      messageType: "info",
    });
    return applyCookies(NextResponse.redirect(retryUrl, { status: 303 }));
  }

  const successUrl = redirectToCheckEmail(request, {
    email: normalizedEmail,
    mode: parsed.data.mode,
    next,
    message: "Code sent. Enter it below to continue.",
    messageType: "info",
    cooldownSeconds: EMAIL_AUTH_MINUTE_LIMIT_SECONDS,
  });

  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}
