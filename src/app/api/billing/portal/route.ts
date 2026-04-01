import { NextResponse } from "next/server";

import {
  ensureStripeCustomer,
  getBillingPortalReturnUrl,
  getStripeClient,
  getViewerAppState,
} from "@/lib/billing";

export async function POST() {
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  try {
    const customerId = await ensureStripeCustomer({
      userId: appState.user.id,
      email: appState.user.email ?? null,
      fullName: appState.profile?.full_name ?? null,
      existingCustomerId: appState.profile?.stripe_customer_id ?? null,
    });

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: getBillingPortalReturnUrl(),
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Seje za portal naročnine ni bilo mogoče ustvariti.",
      },
      { status: 500 },
    );
  }
}
