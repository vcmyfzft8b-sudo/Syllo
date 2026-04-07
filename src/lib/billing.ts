import "server-only";

import { NextResponse } from "next/server";
import Stripe from "stripe";

import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/public-env";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type BillingPlan = "weekly" | "monthly" | "yearly";
export type BillingRequiredCode =
  | "subscription_required"
  | "trial_exhausted"
  | "trial_chat_limit_reached";
export type EntitlementFeature = "study" | "quiz" | "practice_test" | "chat";

type ClaimTrialLectureResult =
  | { allowed: true; mode: "paid" | "trial" }
  | { allowed: false; code: "profile_not_found" | "trial_exhausted" };

export type UserEntitlementState = {
  profile: ProfileRow | null;
  subscriptions: BillingSubscriptionRow[];
  subscription: BillingSubscriptionRow | null;
  hasPaidAccess: boolean;
  onboardingComplete: boolean;
  trialLectureId: string | null;
  hasTrialLectureAvailable: boolean;
  canResumeTrialLecture: boolean;
  trialChatMessagesUsed: number;
  trialChatMessagesRemaining: number;
  canCreateNotes: boolean;
  canAccessPaywalledCreation: boolean;
  shouldShowTrialEntry: boolean;
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);
const TRIAL_CHAT_MESSAGE_LIMIT = 5;

export const BILLING_PLANS: Record<
  BillingPlan,
  {
    id: BillingPlan;
    label: string;
    cadence: string;
    amount: number;
    displayAmount?: string;
    originalDisplayAmount?: string;
    discountNote?: string;
    billingNote?: string;
    annualizedAmount: number;
    blurb: string;
  }
> = {
  weekly: {
    id: "weekly",
    label: "Tedensko",
    cadence: "na teden",
    amount: 9,
    originalDisplayAmount: "10",
    discountNote: "Trenutno 10 % popusta",
    annualizedAmount: 468,
    blurb: "Najhitrejši način, da preizkusiš celoten izdelek.",
  },
  monthly: {
    id: "monthly",
    label: "Mesečno",
    cadence: "na mesec",
    amount: 18,
    originalDisplayAmount: "20",
    discountNote: "Trenutno 10 % popusta",
    annualizedAmount: 216,
    blurb: "Najboljša privzeta izbira za večino študentov.",
  },
  yearly: {
    id: "yearly",
    label: "Letno",
    cadence: "na mesec",
    amount: 119,
    displayAmount: "9.92",
    originalDisplayAmount: "11.02",
    discountNote: "Trenutno 10 % popusta",
    billingNote: "Obračunano letno",
    annualizedAmount: 119,
    blurb: "Najnižja dejanska cena, če uporabljaš aplikacijo celo leto.",
  },
};

export function hasPaidAccess(subscription: BillingSubscriptionRow | null) {
  return Boolean(subscription && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status));
}

export function getActiveSubscription(
  subscriptions: BillingSubscriptionRow[],
): BillingSubscriptionRow | null {
  const sorted = [...subscriptions].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );

  return (
    sorted.find((subscription) => ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) ??
    sorted[0] ??
    null
  );
}

async function getSubscriptionsForUser(userId: string) {
  const { data } = await createSupabaseServiceRoleClient()
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  return (data ?? []) as BillingSubscriptionRow[];
}

async function syncStripeSubscriptionsForCustomer(customerId: string) {
  const stripe = getStripeClient();
  let startingAfter: string | undefined;

  do {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      starting_after: startingAfter,
    });

    for (const subscription of page.data) {
      await syncStripeSubscriptionRecord(subscription);
    }

    if (!page.has_more || page.data.length === 0) {
      break;
    }

    startingAfter = page.data.at(-1)?.id;
  } while (startingAfter);
}

async function resolveUserSubscriptionState(params: {
  userId: string;
  stripeCustomerId: string | null;
  subscriptions?: BillingSubscriptionRow[];
}) {
  let subscriptions = params.subscriptions ?? (await getSubscriptionsForUser(params.userId));
  let subscription = getActiveSubscription(subscriptions);

  if (!subscription && params.stripeCustomerId) {
    try {
      await syncStripeSubscriptionsForCustomer(params.stripeCustomerId);
      subscriptions = await getSubscriptionsForUser(params.userId);
      subscription = getActiveSubscription(subscriptions);
    } catch (error) {
      console.error("Stripe subscription reconciliation failed", {
        userId: params.userId,
        stripeCustomerId: params.stripeCustomerId,
        error,
      });
    }
  }

  return {
    subscriptions,
    subscription,
    hasPaidAccess: hasPaidAccess(subscription),
  };
}

async function getTrialChatMessageUsage(userId: string, trialLectureId: string | null) {
  if (!trialLectureId) {
    return {
      trialChatMessagesUsed: 0,
      trialChatMessagesRemaining: TRIAL_CHAT_MESSAGE_LIMIT,
    };
  }

  const { count } = await createSupabaseServiceRoleClient()
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("lecture_id", trialLectureId)
    .eq("role", "user");

  const used = count ?? 0;
  return {
    trialChatMessagesUsed: used,
    trialChatMessagesRemaining: Math.max(TRIAL_CHAT_MESSAGE_LIMIT - used, 0),
  };
}

async function fetchProfileAndSubscriptions(userId: string) {
  const service = createSupabaseServiceRoleClient();
  const [{ data: profile }, { data: subscriptions }] = await Promise.all([
    service.from("profiles").select("*").eq("id", userId).maybeSingle(),
    service
      .from("billing_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
  ]);

  return {
    profile: (profile ?? null) as ProfileRow | null,
    subscriptions: (subscriptions ?? []) as BillingSubscriptionRow[],
  };
}

async function recoverTrialLectureForUser(params: {
  userId: string;
  profile: ProfileRow | null;
  hasPaidAccess: boolean;
}) {
  if (params.hasPaidAccess || !params.profile || params.profile.trial_lecture_id) {
    return params.profile;
  }

  const service = createSupabaseServiceRoleClient();
  const { data: orphanLectureData } = await service
    .from("lectures")
    .select("id, created_at")
    .eq("user_id", params.userId)
    .eq("access_tier", "trial")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orphanLecture = orphanLectureData as { id: string; created_at: string } | null;

  if (!orphanLecture) {
    return params.profile;
  }

  const repairedProfile = {
    ...params.profile,
    trial_lecture_id: orphanLecture.id,
    trial_started_at: params.profile.trial_started_at ?? orphanLecture.created_at,
    trial_consumed_at: params.profile.trial_consumed_at ?? orphanLecture.created_at,
  };

  await service
    .from("profiles")
    .update({
      trial_lecture_id: repairedProfile.trial_lecture_id,
      trial_started_at: repairedProfile.trial_started_at,
      trial_consumed_at: repairedProfile.trial_consumed_at,
    } as never)
    .eq("id", params.userId);

  return repairedProfile;
}

async function getTrialLectureResumeState(params: {
  userId: string;
  trialLectureId: string | null;
  hasPaidAccess: boolean;
}) {
  if (params.hasPaidAccess || !params.trialLectureId) {
    return false;
  }

  const service = createSupabaseServiceRoleClient();
  const [{ data: lectureData }, { data: artifactData }, { count: transcriptCount }] = await Promise.all([
    service
      .from("lectures")
      .select("id, status")
      .eq("id", params.trialLectureId)
      .eq("user_id", params.userId)
      .maybeSingle(),
    service
      .from("lecture_artifacts")
      .select("lecture_id")
      .eq("lecture_id", params.trialLectureId)
      .maybeSingle(),
    service
      .from("transcript_segments")
      .select("id", { count: "exact", head: true })
      .eq("lecture_id", params.trialLectureId),
  ]);
  const lecture = lectureData as { id: string; status: string } | null;
  const artifact = artifactData as { lecture_id: string } | null;

  if (!lecture) {
    return false;
  }

  if (lecture.status === "ready") {
    return false;
  }

  if (artifact) {
    return false;
  }

  return (transcriptCount ?? 0) === 0;
}

function buildEntitlementState(params: {
  profile: ProfileRow | null;
  subscriptions: BillingSubscriptionRow[];
  subscription: BillingSubscriptionRow | null;
  hasPaidAccess: boolean;
  canResumeTrialLecture: boolean;
  trialChatMessagesUsed: number;
  trialChatMessagesRemaining: number;
}) {
  const onboardingComplete = Boolean(params.profile?.onboarding_completed_at);
  const trialLectureId = params.profile?.trial_lecture_id ?? null;
  const hasTrialLectureAvailable =
    !params.hasPaidAccess && (!trialLectureId || params.canResumeTrialLecture);
  const canCreateNotes = params.hasPaidAccess || hasTrialLectureAvailable;
  const shouldShowTrialEntry = !params.hasPaidAccess;

  return {
    profile: params.profile,
    subscriptions: params.subscriptions,
    subscription: params.subscription,
    hasPaidAccess: params.hasPaidAccess,
    onboardingComplete,
    trialLectureId,
    hasTrialLectureAvailable,
    canResumeTrialLecture: params.canResumeTrialLecture,
    trialChatMessagesUsed: params.trialChatMessagesUsed,
    trialChatMessagesRemaining: params.trialChatMessagesRemaining,
    canCreateNotes,
    canAccessPaywalledCreation: !canCreateNotes,
    shouldShowTrialEntry,
  } satisfies UserEntitlementState;
}

export async function getUserEntitlementState(userId: string) {
  const { profile, subscriptions } = await fetchProfileAndSubscriptions(userId);
  const billingState = await resolveUserSubscriptionState({
    userId,
    stripeCustomerId: profile?.stripe_customer_id ?? null,
    subscriptions,
  });
  const recoveredProfile = await recoverTrialLectureForUser({
    userId,
    profile,
    hasPaidAccess: billingState.hasPaidAccess,
  });
  const canResumeTrialLecture = await getTrialLectureResumeState({
    userId,
    trialLectureId: recoveredProfile?.trial_lecture_id ?? null,
    hasPaidAccess: billingState.hasPaidAccess,
  });
  const trialUsage = await getTrialChatMessageUsage(
    userId,
    recoveredProfile?.trial_lecture_id ?? null,
  );

  return buildEntitlementState({
    profile: recoveredProfile,
    subscriptions: billingState.subscriptions,
    subscription: billingState.subscription,
    hasPaidAccess: billingState.hasPaidAccess,
    canResumeTrialLecture,
    ...trialUsage,
  });
}

export async function getViewerAppState() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const entitlement = await getUserEntitlementState(user.id);

  return {
    user,
    ...entitlement,
  };
}

export function getPlanFromPriceId(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) {
    return null;
  }

  const env = getServerEnv();
  const match = (
    Object.entries({
      weekly: env.STRIPE_PRICE_WEEKLY,
      monthly: env.STRIPE_PRICE_MONTHLY,
      yearly: env.STRIPE_PRICE_YEARLY,
    }) as Array<[BillingPlan, string | undefined]>
  ).find(([, configuredPriceId]) => configuredPriceId === priceId);

  return match?.[0] ?? null;
}

export function getPriceIdForPlan(plan: BillingPlan) {
  const env = getServerEnv();

  const priceIdMap: Record<BillingPlan, string | undefined> = {
    weekly: env.STRIPE_PRICE_WEEKLY,
    monthly: env.STRIPE_PRICE_MONTHLY,
    yearly: env.STRIPE_PRICE_YEARLY,
  };

  const priceId = priceIdMap[plan];

  if (!priceId) {
    throw new Error(`Missing Stripe price id for ${plan}.`);
  }

  return priceId;
}

export function getStripeClient() {
  const env = getServerEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  return new Stripe(env.STRIPE_SECRET_KEY);
}

export async function ensureStripeCustomer(params: {
  userId: string;
  email: string | null;
  fullName: string | null;
  existingCustomerId: string | null;
}) {
  if (params.existingCustomerId) {
    return params.existingCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: params.email ?? undefined,
    name: params.fullName ?? undefined,
    metadata: {
      userId: params.userId,
    },
  });

  await createSupabaseServiceRoleClient()
    .from("profiles")
    .update({
      stripe_customer_id: customer.id,
    } as never)
    .eq("id", params.userId);

  return customer.id;
}

export async function syncStripeSubscription(subscriptionId: string) {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await syncStripeSubscriptionRecord(subscription);

  return subscription;
}

export async function syncStripeSubscriptionRecord(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = getPlanFromPriceId(priceId) ?? "monthly";
  const userId = subscription.metadata.userId || null;

  let resolvedUserId = userId;

  if (!resolvedUserId && customerId) {
    const { data: profile } = await createSupabaseServiceRoleClient()
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    resolvedUserId = ((profile as { id: string } | null)?.id ?? null);
  }

  if (!resolvedUserId) {
    throw new Error(`Unable to resolve user for Stripe subscription ${subscription.id}.`);
  }

  const service = createSupabaseServiceRoleClient();

  await service
    .from("profiles")
    .update({
      stripe_customer_id: customerId,
    } as never)
    .eq("id", resolvedUserId);

  await service
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: resolvedUserId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        plan,
        status: subscription.status,
        currency: item?.price?.currency ?? "eur",
        unit_amount: item?.price?.unit_amount ?? null,
        current_period_end: item?.current_period_end
          ? new Date(item.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
      } as never,
      { onConflict: "stripe_subscription_id" },
    );
}

export function getBillingSuccessUrl() {
  const env = getPublicEnv();
  return `${env.siteUrl}/app/start?checkout=success`;
}

export function getBillingCancelUrl() {
  const env = getPublicEnv();
  return `${env.siteUrl}/app/start?checkout=cancelled`;
}

export function getBillingPortalReturnUrl() {
  const env = getPublicEnv();
  return `${env.siteUrl}/app/settings`;
}

export function getPaywallPath() {
  return "/app/start";
}

export function createBillingRequiredResponse(
  message = "Za to dejanje je potreben plačljiv paket.",
  code: BillingRequiredCode = "subscription_required",
) {
  return NextResponse.json(
    {
      error: message,
      code,
      redirectTo: getPaywallPath(),
    },
    { status: 402 },
  );
}

export async function hasPaidAccessForUserId(userId: string) {
  const entitlement = await getUserEntitlementState(userId);
  return entitlement.hasPaidAccess;
}

export async function canCreateLectureForUser(userId: string) {
  const entitlement = await getUserEntitlementState(userId);
  return entitlement.hasPaidAccess || entitlement.hasTrialLectureAvailable;
}

export async function claimTrialLecture(userId: string, lectureId: string) {
  const service = createSupabaseServiceRoleClient();
  const rpc = service.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("claim_trial_lecture", {
    p_user_id: userId,
    p_lecture_id: lectureId,
  });

  if (error) {
    throw error;
  }

  return (data ?? {
    allowed: false,
    code: "trial_exhausted",
  }) as ClaimTrialLectureResult;
}

export async function canUseLectureFeatures(
  userId: string,
  lectureId: string,
  feature: EntitlementFeature,
) {
  void feature;
  const entitlement = await getUserEntitlementState(userId);

  if (entitlement.hasPaidAccess) {
    return {
      allowed: true,
      entitlement,
    };
  }

  if (entitlement.trialLectureId === lectureId) {
    return {
      allowed: true,
      entitlement,
    };
  }

  return {
    allowed: false,
    code: "trial_exhausted" as const,
    entitlement,
  };
}

export async function canSendTrialChatMessage(userId: string, lectureId: string) {
  const entitlement = await getUserEntitlementState(userId);

  if (entitlement.hasPaidAccess) {
    return {
      allowed: true,
      entitlement,
    };
  }

  if (entitlement.trialLectureId !== lectureId) {
    return {
      allowed: false,
      code: "trial_exhausted" as const,
      entitlement,
    };
  }

  if (entitlement.trialChatMessagesRemaining <= 0) {
    return {
      allowed: false,
      code: "trial_chat_limit_reached" as const,
      entitlement,
    };
  }

  return {
    allowed: true,
    entitlement,
  };
}
