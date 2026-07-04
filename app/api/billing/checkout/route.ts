/**
 * POST /api/billing/checkout
 * Body: { planId, groupId }
 * Returns: { url } to redirect to Stripe Checkout
 *
 * SECURITY: requester must be authenticated AND must be a member of
 * the target group (so they can't create checkouts for arbitrary
 * other groups). Previously this endpoint had NO auth check at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession, PLANS } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const { planId, groupId } = (await req.json()) as { planId: string; groupId: string };
  if (!planId || !groupId) {
    return NextResponse.json({ error: "Missing planId or groupId" }, { status: 400 });
  }

  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  // Verify membership in the target group before creating a checkout
  // session. Prevents a logged-in user from starting a checkout for
  // any arbitrary groupId.
  const membership = await db.groupMember.findFirst({
    where: { groupId, userId: userId! },
    select: { id: true, role: true },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of this group" },
      { status: 403 }
    );
  }

  const origin = req.headers.get("origin") ?? "http://localhost:3000";
  const result = await createCheckoutSession({
    planId,
    groupId,
    successUrl: `${origin}/?billing=success`,
    cancelUrl: `${origin}/?billing=canceled`,
  });

  if ("url" in result) {
    return NextResponse.json(result);
  }
  return NextResponse.json(result, { status: 503 });
}
