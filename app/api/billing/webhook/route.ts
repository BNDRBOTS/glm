/**
 * POST /api/billing/webhook
 * ---------------------------------------------------------------------
 * REAL Stripe webhook handler. Verifies signature, routes events.
 *
 * Setup:
 *   1. Set STRIPE_WEBHOOK_SECRET in env (from Stripe Dashboard webhook endpoint)
 *   2. Point Stripe webhook at https://YOUR-APP/api/billing/webhook
 *   3. Subscribe to events: checkout.session.completed,
 *      customer.subscription.updated, customer.subscription.deleted
 *
 * Returns 200 even on unhandled events (Stripe retries on non-2xx).
 * Returns 400 only on signature verification failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, handleWebhookEvent, isBillingConfigured } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isBillingConfigured()) {
    // Stripe not set up — return 200 so we don't break the route,
    // but signal that billing is off
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 200 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const payload = await req.text();

  let event;
  try {
    event = await constructWebhookEvent(payload, signature);
  } catch (e) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  try {
    await handleWebhookEvent(event);
    return NextResponse.json({ received: true, type: event.type });
  } catch (e) {
    // Transient errors (DB connection blip, Prisma P1001, etc.) MUST
    // return 5xx so Stripe retries. Permanent/unknown errors still log
    // and return 200 so we don't build up an infinite retry queue.
    //
    // Prisma error codes that indicate retry-worthy transient issues:
    //   P1001 (can't reach db), P1002 (timed out), P1008 (ops timeout),
    //   P1017 (server closed conn)
    const msg = (e as Error)?.message ?? String(e);
    const isTransient = /P100[12]|P1008|P1017|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
    console.error("Stripe webhook handler error:", msg);
    if (isTransient) {
      return NextResponse.json(
        { error: `Transient handler error: ${msg}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ received: true, handlerError: msg }, { status: 200 });
  }
}
