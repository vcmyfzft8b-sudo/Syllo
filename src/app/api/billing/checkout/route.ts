import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureStripeCustomer,
  getBillingCancelUrl,
  getBillingSuccessUrl,
  getPriceIdForPlan,
  getStripeClient,
  getViewerAppState,
} from "@/lib/billing";
import { parseJsonRequest } from "@/lib/request-validation";

const checkoutSchema = z.object({
  plan: z.enum(["weekly", "monthly", "yearly"]),
});

async function createCheckoutSession(plan: z.infer<typeof checkoutSchema>["plan"]) {
  const appState = await getViewerAppState();

  if (!appState) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized",
    };
  }

  if (!appState.onboardingComplete) {
    return {
      ok: false as const,
      status: 400,
      error: "Complete onboarding first.",
    };
  }

  try {
    const customerId = await ensureStripeCustomer({
      userId: appState.user.id,
      email: appState.user.email ?? null,
      fullName: appState.profile?.full_name ?? null,
      existingCustomerId: appState.profile?.stripe_customer_id ?? null,
    });

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: getPriceIdForPlan(plan),
          quantity: 1,
        },
      ],
      success_url: getBillingSuccessUrl(),
      cancel_url: getBillingCancelUrl(),
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      metadata: {
        userId: appState.user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          userId: appState.user.id,
          plan,
        },
      },
    });

    if (!session.url) {
      return {
        ok: false as const,
        status: 500,
        error: "Stripe checkout did not return a redirect URL.",
      };
    }

    return {
      ok: true as const,
      url: session.url,
    };
  } catch (error) {
    return {
      ok: false as const,
      status: 500,
      error: error instanceof Error ? error.message : "Could not create checkout session.",
    };
  }
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, checkoutSchema, {
    maxBytes: 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const result = await createCheckoutSession(parsed.data.plan);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ url: result.url });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = checkoutSchema.safeParse({
    plan: url.searchParams.get("plan"),
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/app/start?checkout=cancelled", url), 303);
  }

  const result = await createCheckoutSession(parsed.data.plan);

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/app/start?checkout=cancelled&error=${encodeURIComponent(result.error)}`, url),
      303,
    );
  }

  return NextResponse.redirect(result.url, 303);
}
