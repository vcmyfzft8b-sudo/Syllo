import Stripe from "stripe";

const MEMO50_COUPON_ID = "memo50-first-cycle";
const MEMO50_PROMOTION_CODE = "MEMO50";

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

  const memo50Coupon = await findOrCreateMemo50Coupon(stripe, product.id);
  const memo50PromotionCode = await findOrCreateMemo50PromotionCode(stripe, memo50Coupon.id);

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
  console.log(`MEMO50 coupon: ${memo50Coupon.id}`);
  console.log(`MEMO50 promotion code: ${memo50PromotionCode.id} (${memo50PromotionCode.code})`);
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
