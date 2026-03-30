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

export async function POST(request: Request) {
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!appState.onboardingComplete) {
    return NextResponse.json({ error: "Complete onboarding first." }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, checkoutSchema, {
    maxBytes: 1024,
  });

  if (!parsed.success) {
    return parsed.response;
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
          price: getPriceIdForPlan(parsed.data.plan),
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
        plan: parsed.data.plan,
      },
      subscription_data: {
        metadata: {
          userId: appState.user.id,
          plan: parsed.data.plan,
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not create checkout session.",
      },
      { status: 500 },
    );
  }
}
