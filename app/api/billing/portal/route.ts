/**
 * POST /api/billing/portal
 * Body: { groupId }   (optional — if omitted, derives from membership)
 * Returns: { url } to Stripe customer portal for subscription management
 *
 * SECURITY: requester must be authenticated AND the customerId they
 * pass must match a group they are a member of. Previously this
 * endpoint accepted any customerId from any client — letting anyone
 * open a billing portal for any Stripe customer id.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPortalSession } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { groupId?: string; customerId?: string };
  const groupId = body.groupId;
  const customerId = body.customerId;

  if (!groupId && !customerId) {
    return NextResponse.json(
      { error: "Missing groupId or customerId" },
      { status: 400 }
    );
  }

  // Resolve a group that (a) matches the supplied id (or by customer id)
  // AND (b) the requester is a member of. This is the access boundary.
  const group = await db.group.findFirst({
    where: {
      AND: [
        groupId
          ? { id: groupId }
          : customerId
          ? { stripeCustomerId: customerId }
          : {},
        { members: { some: { userId: userId! } } },
      ],
    },
    select: { id: true, stripeCustomerId: true },
  });

  if (!group) {
    return NextResponse.json(
      { error: "Group not found or you are not a member" },
      { status: 403 }
    );
  }

  if (!group.stripeCustomerId) {
    return NextResponse.json(
      { error: "No Stripe customer is associated with this group yet" },
      { status: 400 }
    );
  }

  const origin = req.headers.get("origin") ?? "http://localhost:3000";
  const result = await createPortalSession({
    customerId: group.stripeCustomerId,
    returnUrl: `${origin}/`,
  });
  if ("url" in result) {
    return NextResponse.json(result);
  }
  return NextResponse.json(result, { status: 503 });
}
