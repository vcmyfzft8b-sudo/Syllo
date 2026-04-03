import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getServerEnv } from "@/lib/server-env";
import { syncStripeSubscription, syncStripeSubscriptionRecord } from "@/lib/billing";

function extractSubscriptionId(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return typeof session.subscription === "string" ? session.subscription : null;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    return (event.data.object as Stripe.Subscription).id;
  }

  return null;
}

export async function POST(request: Request) {
  const env = getServerEnv();

  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Stripe webhook signature verification failed", {
      error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook signature verification failed.",
      },
      { status: 400 },
    );
  }

  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncStripeSubscriptionRecord(event.data.object as Stripe.Subscription);
    } else {
      const subscriptionId = extractSubscriptionId(event);

      if (subscriptionId) {
        await syncStripeSubscription(subscriptionId);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook handling failed.",
      },
      { status: 500 },
    );
  }
}
