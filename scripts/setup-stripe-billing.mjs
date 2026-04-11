import Stripe from "stripe";

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function findOrCreateProduct(stripe) {
  const existingProducts = await stripe.products.list({
    active: true,
    limit: 100,
  });

  const existing =
    existingProducts.data.find(
      (product) => product.metadata?.app === "memo" && product.metadata?.billing_key === "pro",
    ) ?? null;

  if (existing) {
    return existing;
  }

  return stripe.products.create({
    name: "Memo Pro",
    description: "Personalized study notes, flashcards, quizzes, and practice tests.",
    metadata: {
      app: "memo",
      billing_key: "pro",
    },
  });
}

async function findOrCreatePrice(stripe, params) {
  const prices = await stripe.prices.list({
    product: params.productId,
    active: true,
    limit: 100,
  });

  const existing =
    prices.data.find(
      (price) =>
        price.currency === "eur" &&
        price.unit_amount === params.unitAmount &&
        price.recurring?.interval === params.interval &&
        (price.recurring?.interval_count ?? 1) === params.intervalCount &&
        price.metadata?.plan === params.plan,
    ) ?? null;

  if (existing) {
    return existing;
  }

  return stripe.prices.create({
    product: params.productId,
    currency: "eur",
    unit_amount: params.unitAmount,
    recurring: {
      interval: params.interval,
      interval_count: params.intervalCount,
    },
    metadata: {
      app: "memo",
      billing_key: "pro",
      plan: params.plan,
    },
    nickname: params.nickname,
  });
}

async function ensureBillingPortalConfiguration(stripe, returnUrl) {
  const configurations = await stripe.billingPortal.configurations.list({
    is_default: true,
    active: true,
    limit: 10,
  });

  if (configurations.data[0]) {
    return configurations.data[0];
  }

  return stripe.billingPortal.configurations.create({
    name: "Memo default portal",
    default_return_url: returnUrl,
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "name"],
      },
      invoice_history: {
        enabled: true,
      },
      payment_method_update: {
        enabled: true,
      },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "unused", "other"],
        },
      },
      subscription_update: {
        enabled: false,
      },
    },
    metadata: {
      app: "memo",
      billing_key: "pro",
    },
  });
}

async function findWebhookEndpoint(stripe, webhookUrl) {
  const endpoints = await stripe.webhookEndpoints.list({
    limit: 100,
  });

  return endpoints.data.find((endpoint) => endpoint.url === webhookUrl) ?? null;
}

async function main() {
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  const siteUrl =
    getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? getOptionalEnv("SITE_URL") ?? "http://localhost:3000";
  const webhookUrl = getOptionalEnv("STRIPE_WEBHOOK_URL") ?? `${siteUrl}/api/stripe/webhook`;

  const product = await findOrCreateProduct(stripe);

  const weekly = await findOrCreatePrice(stripe, {
    productId: product.id,
    plan: "weekly",
    nickname: "Memo Pro Weekly",
    unitAmount: 1000,
    interval: "week",
    intervalCount: 1,
  });

  const monthly = await findOrCreatePrice(stripe, {
    productId: product.id,
    plan: "monthly",
    nickname: "Memo Pro Monthly",
    unitAmount: 2000,
    interval: "month",
    intervalCount: 1,
  });

  const yearly = await findOrCreatePrice(stripe, {
    productId: product.id,
    plan: "yearly",
    nickname: "Memo Pro Yearly",
    unitAmount: 13000,
    interval: "year",
    intervalCount: 1,
  });

  const portal = await ensureBillingPortalConfiguration(stripe, `${siteUrl}/app/settings`);
  const existingWebhook = await findWebhookEndpoint(stripe, webhookUrl);
  let createdWebhook = null;

  if (!existingWebhook) {
    createdWebhook = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: [
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ],
      metadata: {
        app: "memo",
        billing_key: "pro",
      },
      description: "Memo billing sync",
    });
  }

  console.log("");
  console.log("Stripe setup complete.");
  console.log("");
  console.log(`Product: ${product.id}`);
  console.log(`Weekly price: ${weekly.id}`);
  console.log(`Monthly price: ${monthly.id}`);
  console.log(`Yearly price: ${yearly.id}`);
  console.log(`Billing portal config: ${portal.id}`);
  console.log("");
  console.log("Add these env vars:");
  console.log(`STRIPE_PRICE_WEEKLY=${weekly.id}`);
  console.log(`STRIPE_PRICE_MONTHLY=${monthly.id}`);
  console.log(`STRIPE_PRICE_YEARLY=${yearly.id}`);

  if (createdWebhook) {
    console.log(`STRIPE_WEBHOOK_SECRET=${createdWebhook.secret}`);
    console.log(`Webhook endpoint: ${createdWebhook.id} -> ${createdWebhook.url}`);
  } else if (existingWebhook) {
    console.log("");
    console.log(
      `Webhook endpoint already exists at ${existingWebhook.url}. Stripe will not show the signing secret again, so keep the existing STRIPE_WEBHOOK_SECRET from your dashboard or previous setup.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
