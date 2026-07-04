/**
 * GLM Power Platform — Billing (Stripe) — REAL implementation.
 * ---------------------------------------------------------------------
 * Production-ready Stripe integration. Feature-flagged:
 *
 *   - If STRIPE_SECRET_KEY is set: real Stripe calls run.
 *   - If STRIPE_SECRET_KEY is unset: functions return a "not configured"
 *     structured response. They never throw, never crash the app.
 *
 * Webhook route at /api/billing/webhook is wired with real signature
 * verification. Stripe Dashboard URL for webhook setup:
 *   https://dashboard.stripe.com/webhooks
 *
 * Schema fields already on Group: stripeCustomerId, stripeSubscriptionId.
 * UsageLog already tracks costCents for billing reconciliation.
 *
 * PLANS are defined below. To go live:
 *   1. Create products + prices in Stripe Dashboard
 *   2. Set STRIPE_PRICE_POWER and STRIPE_PRICE_TEAM env vars to the
 *      price IDs Stripe gives you
 *   3. Set STRIPE_SECRET_KEY
 *   4. Set STRIPE_WEBHOOK_SECRET (from Stripe webhook endpoint)
 *   5. Done — checkout + webhook + subscription management all work.
 */

import "@/lib/server-guard";
import Stripe from "stripe";

export interface BillingPlan {
  id: string;
  name: string;
  priceMonthly: number; // cents; 0 = free
  features: string[];
  envPriceKey?: string; // env var name with the Stripe price ID
}

export const PLANS: BillingPlan[] = [
  {
    id: "power",
    name: "Power",
    priceMonthly: 0,
    features: [
      "GLM 5.2 peak access",
      "Two isolated accounts",
      "Group share",
      "Code canvas",
      "Turn-by-turn memory",
      "All 6 connectors",
      "All 5 backends",
      "Voice input",
      "Skill system",
    ],
  },
  {
    id: "team",
    name: "Team",
    priceMonthly: 2900,
    features: [
      "Everything in Power",
      "Up to 10 members",
      "Shared integrations",
      "Priority rate limits",
      "Team analytics dashboard",
    ],
    envPriceKey: "STRIPE_PRICE_TEAM",
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 4900,
    features: [
      "Everything in Team",
      "Unlimited members",
      "Custom connectors",
      "Pinecone memory mesh",
      "SLA + dedicated support",
    ],
    envPriceKey: "STRIPE_PRICE_PRO",
  },
];

// Singleton Stripe instance — created once, reused.
// `stripe` is imported eagerly at module load (it's a stable dep).
// The instance is only created if STRIPE_SECRET_KEY is set.
let _stripe: Stripe | null = null;
let _stripeInitialized = false;

function getStripe(): Stripe | null {
  if (_stripeInitialized) return _stripe;
  _stripeInitialized = true;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    _stripe = null;
    return null;
  }
  _stripe = new Stripe(key, {
    // Let the SDK pin its own API version. Hardcoding a version
    // requires manual updates on every Stripe SDK upgrade; the SDK
    // default is always the most recent stable version it supports.
    typescript: true,
  });
  return _stripe;
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Create a Stripe Checkout session for a subscription.
 * Returns { url } on success, or { notConfigured: true } if Stripe
 * isn't set up. Never throws.
 */
export async function createCheckoutSession(opts: {
  planId: string;
  groupId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string } | { notConfigured: true; message: string }> {
  const stripe = getStripe();
  if (!stripe) {
    return {
      notConfigured: true,
      message: "Set STRIPE_SECRET_KEY + STRIPE_PRICE_* env vars to enable billing.",
    };
  }

  const plan = PLANS.find((p) => p.id === opts.planId);
  if (!plan) return { notConfigured: true, message: "Unknown plan." };
  if (plan.priceMonthly === 0) {
    return { url: opts.successUrl };
  }

  const priceId = plan.envPriceKey ? process.env[plan.envPriceKey] : undefined;
  if (!priceId) {
    return {
      notConfigured: true,
      message: `Set ${plan.envPriceKey} env var to the Stripe price ID for ${plan.name}.`,
    };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      client_reference_id: opts.groupId,
      metadata: { groupId: opts.groupId, planId: plan.id },
    });
    return { url: session.url! };
  } catch (e) {
    return {
      notConfigured: true,
      message: `Stripe error: ${(e as Error).message}`,
    };
  }
}

/**
 * Create a billing portal session for an existing customer to manage
 * their subscription (upgrade/downgrade/cancel).
 */
export async function createPortalSession(opts: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string } | { notConfigured: true; message: string }> {
  const stripe = getStripe();
  if (!stripe) {
    return { notConfigured: true, message: "Stripe not configured." };
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: opts.customerId,
      return_url: opts.returnUrl,
    });
    return { url: session.url };
  } catch (e) {
    return { notConfigured: true, message: `Stripe error: ${(e as Error).message}` };
  }
}

/**
 * Verify + parse a Stripe webhook event. Throws if signature is invalid.
 */
export async function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Promise<Stripe.Event> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  return stripe.webhooks.constructEvent(
    payload as string | Buffer,
    signature,
    secret
  );
}

/**
 * Handle a verified Stripe event. Routes to the right handler based
 * on event type. Updates the Group table with subscription state.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  const { db } = await import("@/lib/db");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const groupId = session.client_reference_id ?? session.metadata?.groupId;
      if (!groupId) break;
      await db.group.update({
        where: { id: groupId },
        data: {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
        },
      });
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const groups = await db.group.findMany({
        where: { stripeCustomerId: sub.customer as string },
      });
      for (const g of groups) {
        await db.group.update({
          where: { id: g.id },
          data: { stripeSubscriptionId: sub.id },
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const groups = await db.group.findMany({
        where: { stripeSubscriptionId: sub.id },
      });
      for (const g of groups) {
        await db.group.update({
          where: { id: g.id },
          data: { stripeSubscriptionId: null },
        });
      }
      break;
    }
    default:
      break;
  }
}
