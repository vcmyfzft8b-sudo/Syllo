import "server-only";

import { NextResponse } from "next/server";
import Stripe from "stripe";

import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/public-env";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type BillingPlan = "weekly" | "monthly" | "yearly";

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
    label: "Weekly",
    cadence: "per week",
    amount: 9,
    originalDisplayAmount: "10",
    discountNote: "10% off right now",
    annualizedAmount: 468,
    blurb: "Fastest way to try the full product.",
  },
  monthly: {
    id: "monthly",
    label: "Monthly",
    cadence: "per month",
    amount: 18,
    originalDisplayAmount: "20",
    discountNote: "10% off right now",
    annualizedAmount: 216,
    blurb: "Best default for most students.",
  },
  yearly: {
    id: "yearly",
    label: "Yearly",
    cadence: "per month",
    amount: 119,
    displayAmount: "9.92",
    originalDisplayAmount: "11.02",
    discountNote: "10% off right now",
    billingNote: "Billed annually",
    annualizedAmount: 119,
    blurb: "Lowest effective price if they stay through the year.",
  },
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

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

export async function getViewerAppState() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [{ data: profile }, { data: subscriptions }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("billing_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  const typedProfile = (profile ?? null) as ProfileRow | null;
  const typedSubscriptions = (subscriptions ?? []) as BillingSubscriptionRow[];
  const billingState = await resolveUserSubscriptionState({
    userId: user.id,
    stripeCustomerId: typedProfile?.stripe_customer_id ?? null,
    subscriptions: typedSubscriptions,
  });
  const onboardingComplete = Boolean(typedProfile?.onboarding_completed_at);

  return {
    user,
    profile: typedProfile,
    subscriptions: billingState.subscriptions,
    subscription: billingState.subscription,
    onboardingComplete,
    hasPaidAccess: billingState.hasPaidAccess,
  };
}

export function getPlanFromPriceId(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) {
    return null;
  }

  const env = getServerEnv();
  const match = (Object.entries({
    weekly: env.STRIPE_PRICE_WEEKLY,
    monthly: env.STRIPE_PRICE_MONTHLY,
    yearly: env.STRIPE_PRICE_YEARLY,
  }) as Array<[BillingPlan, string | undefined]>).find(([, configuredPriceId]) => configuredPriceId === priceId);

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

export function createBillingRequiredResponse(message = "A paid plan is required for this action.") {
  return NextResponse.json(
    {
      error: message,
      code: "subscription_required",
      redirectTo: getPaywallPath(),
    },
    { status: 402 },
  );
}

export async function hasPaidAccessForUserId(userId: string) {
  const service = createSupabaseServiceRoleClient();
  const [{ data: profile }, { data: subscriptions }] = await Promise.all([
    service.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle(),
    service
      .from("billing_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
  ]);

  const billingState = await resolveUserSubscriptionState({
    userId,
    stripeCustomerId: (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null,
    subscriptions: (subscriptions ?? []) as BillingSubscriptionRow[],
  });

  return billingState.hasPaidAccess;
}
