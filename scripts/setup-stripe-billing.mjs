import Stripe from "stripe";

const MEMO50_COUPON_ID = "memo50-first-cycle";
const MEMO50_PROMOTION_CODE = "MEMO50";
const BILLING_WEBHOOK_DESCRIPTION = "Memo billing sync";
const BILLING_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

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

function isStripeMissingResourceError(error) {
  return (
    error &&
    typeof error === "object" &&
    ("code" in error || "type" in error) &&
    error.code === "resource_missing"
  );
}

function getPromotionCodeCouponId(promotionCode) {
  const coupon = promotionCode.promotion?.coupon;
  return typeof coupon === "string" ? coupon : coupon?.id ?? null;
}

function assertMemo50Coupon(coupon, productId) {
  if (coupon.deleted) {
    throw new Error(`Stripe coupon ${MEMO50_COUPON_ID} was deleted and cannot be reused.`);
  }

  const products = coupon.applies_to?.products ?? [];
  const appliesToProduct = products.length === 1 && products[0] === productId;

  if (coupon.percent_off !== 50 || coupon.duration !== "once" || !appliesToProduct) {
    throw new Error(
      `Stripe coupon ${MEMO50_COUPON_ID} already exists, but it is not a 50% first-cycle discount for product ${productId}.`,
    );
  }
}

async function findOrCreateMemo50Coupon(stripe, productId) {
  try {
    const coupon = await stripe.coupons.retrieve(MEMO50_COUPON_ID);
    assertMemo50Coupon(coupon, productId);
    return coupon;
  } catch (error) {
    if (!isStripeMissingResourceError(error)) {
      throw error;
    }
  }

  return stripe.coupons.create({
    id: MEMO50_COUPON_ID,
    name: "MEMO50 - 50% off first billing cycle",
    percent_off: 50,
    duration: "once",
    applies_to: {
      products: [productId],
    },
    metadata: {
      app: "memo",
      billing_key: "pro",
      promotion_code: MEMO50_PROMOTION_CODE,
    },
  });
}

function assertMemo50PromotionCode(promotionCode, couponId) {
  const couponMatches = getPromotionCodeCouponId(promotionCode) === couponId;
  const isCustomerRestricted = Boolean(promotionCode.customer || promotionCode.customer_account);
  const hasUsageLimit = promotionCode.max_redemptions !== null;
  const expires = promotionCode.expires_at !== null;
  const isFirstTransactionOnly = promotionCode.restrictions?.first_time_transaction === true;
  const hasMinimumAmount = promotionCode.restrictions?.minimum_amount != null;

  if (
    !couponMatches ||
    isCustomerRestricted ||
    hasUsageLimit ||
    expires ||
    isFirstTransactionOnly ||
    hasMinimumAmount
  ) {
    throw new Error(
      `Active Stripe promotion code ${MEMO50_PROMOTION_CODE} already exists, but it does not match the expected unrestricted first-cycle discount.`,
    );
  }
}

async function findOrCreateMemo50PromotionCode(stripe, couponId) {
  const existingCodes = await stripe.promotionCodes.list({
    active: true,
    code: MEMO50_PROMOTION_CODE,
    limit: 100,
  });
  const existing = existingCodes.data[0] ?? null;

  if (existing) {
    assertMemo50PromotionCode(existing, couponId);
    return existing;
  }

  return stripe.promotionCodes.create({
    code: MEMO50_PROMOTION_CODE,
    active: true,
    promotion: {
      type: "coupon",
      coupon: couponId,
    },
    metadata: {
      app: "memo",
      billing_key: "pro",
      coupon_id: couponId,
    },
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

function isManagedBillingWebhook(endpoint) {
  return (
    endpoint.metadata?.app === "memo" &&
    endpoint.metadata?.billing_key === "pro" &&
    endpoint.description === BILLING_WEBHOOK_DESCRIPTION
  );
}

function hasExpectedWebhookEvents(endpoint) {
  const enabledEvents = [...endpoint.enabled_events].sort();
  const expectedEvents = [...BILLING_WEBHOOK_EVENTS].sort();

  return (
    enabledEvents.length === expectedEvents.length &&
    enabledEvents.every((event, index) => event === expectedEvents[index])
  );
}

async function resolveFinalWebhookUrl(webhookUrl) {
  let currentUrl = webhookUrl;

  for (let index = 0; index < 3; index += 1) {
    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
      });
      const location = response.headers.get("location");

      if (!location || response.status < 300 || response.status >= 400) {
        return currentUrl;
      }

      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      return currentUrl;
    }
  }

  return currentUrl;
}

async function ensureWebhookEndpoint(stripe, webhookUrl) {
  const endpoints = await stripe.webhookEndpoints.list({
    limit: 100,
  });
  const managedEndpoints = endpoints.data.filter(isManagedBillingWebhook);
  const exactMatch = endpoints.data.find((endpoint) => endpoint.url === webhookUrl) ?? null;

  async function pruneManagedDuplicates(keepEndpointId) {
    const duplicateEndpoints = managedEndpoints.filter((endpoint) => endpoint.id !== keepEndpointId);
    const removedIds = [];

    for (const endpoint of duplicateEndpoints) {
      await stripe.webhookEndpoints.del(endpoint.id);
      removedIds.push(endpoint.id);
    }

    return removedIds;
  }

  if (exactMatch) {
    if (
      isManagedBillingWebhook(exactMatch) &&
      hasExpectedWebhookEvents(exactMatch)
    ) {
      return {
        endpoint: exactMatch,
        removedIds: await pruneManagedDuplicates(exactMatch.id),
        status: "existing",
      };
    }

    const updated = await stripe.webhookEndpoints.update(exactMatch.id, {
      enabled_events: BILLING_WEBHOOK_EVENTS,
      metadata: {
        app: "memo",
        billing_key: "pro",
      },
      description: BILLING_WEBHOOK_DESCRIPTION,
    });

    return {
      endpoint: updated,
      removedIds: await pruneManagedDuplicates(updated.id),
      status: "updated",
    };
  }

  const managedEndpoint = managedEndpoints[0] ?? null;

  if (managedEndpoint) {
    const updated = await stripe.webhookEndpoints.update(managedEndpoint.id, {
      url: webhookUrl,
      enabled_events: BILLING_WEBHOOK_EVENTS,
      metadata: {
        app: "memo",
        billing_key: "pro",
      },
      description: BILLING_WEBHOOK_DESCRIPTION,
    });

    return {
      endpoint: updated,
      removedIds: await pruneManagedDuplicates(updated.id),
      status: "updated",
      previousUrl: managedEndpoint.url,
    };
  }

  const created = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: BILLING_WEBHOOK_EVENTS,
    metadata: {
      app: "memo",
      billing_key: "pro",
    },
    description: BILLING_WEBHOOK_DESCRIPTION,
  });

  return {
    endpoint: created,
    removedIds: await pruneManagedDuplicates(created.id),
    status: "created",
  };
}

async function main() {
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  const siteUrl =
    getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? getOptionalEnv("SITE_URL") ?? "http://localhost:3000";
  const configuredWebhookUrl = getOptionalEnv("STRIPE_WEBHOOK_URL") ?? `${siteUrl}/api/stripe/webhook`;
  const webhookUrl = await resolveFinalWebhookUrl(configuredWebhookUrl);

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

  const memo50Coupon = await findOrCreateMemo50Coupon(stripe, product.id);
  const memo50PromotionCode = await findOrCreateMemo50PromotionCode(stripe, memo50Coupon.id);

  const portal = await ensureBillingPortalConfiguration(stripe, `${siteUrl}/app/settings`);
  const webhookResult = await ensureWebhookEndpoint(stripe, webhookUrl);

  console.log("");
  console.log("Stripe setup complete.");
  console.log("");
  console.log(`Product: ${product.id}`);
  console.log(`Weekly price: ${weekly.id}`);
  console.log(`Monthly price: ${monthly.id}`);
  console.log(`Yearly price: ${yearly.id}`);
  console.log(`MEMO50 coupon: ${memo50Coupon.id}`);
  console.log(`MEMO50 promotion code: ${memo50PromotionCode.id} (${memo50PromotionCode.code})`);
  console.log(`Billing portal config: ${portal.id}`);
  console.log("");
  console.log("Add these env vars:");
  console.log(`STRIPE_PRICE_WEEKLY=${weekly.id}`);
  console.log(`STRIPE_PRICE_MONTHLY=${monthly.id}`);
  console.log(`STRIPE_PRICE_YEARLY=${yearly.id}`);
  console.log(`STRIPE_WEBHOOK_URL=${webhookUrl}`);

  if (configuredWebhookUrl !== webhookUrl) {
    console.log("");
    console.log(`Resolved webhook URL redirect: ${configuredWebhookUrl} -> ${webhookUrl}`);
  }

  console.log("");

  if (webhookResult.removedIds.length > 0) {
    console.log(`Removed duplicate webhook endpoints: ${webhookResult.removedIds.join(", ")}`);
    console.log("");
  }

  if (webhookResult.status === "created") {
    console.log(`STRIPE_WEBHOOK_SECRET=${webhookResult.endpoint.secret}`);
    console.log(`Webhook endpoint created: ${webhookResult.endpoint.id} -> ${webhookResult.endpoint.url}`);
    return;
  }

  if (webhookResult.status === "updated") {
    if (webhookResult.previousUrl && webhookResult.previousUrl !== webhookResult.endpoint.url) {
      console.log(
        `Webhook endpoint updated: ${webhookResult.endpoint.id} -> ${webhookResult.previousUrl} -> ${webhookResult.endpoint.url}`,
      );
    } else {
      console.log(`Webhook endpoint updated: ${webhookResult.endpoint.id} -> ${webhookResult.endpoint.url}`);
    }

    console.log(
      "Keep the existing STRIPE_WEBHOOK_SECRET from Stripe Dashboard or your previous setup. Stripe does not show the signing secret again for an existing endpoint.",
    );
    return;
  }

  console.log(
    `Webhook endpoint already exists at ${webhookResult.endpoint.url}. Keep the existing STRIPE_WEBHOOK_SECRET from Stripe Dashboard or your previous setup.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
