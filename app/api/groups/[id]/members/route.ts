/**
 * /api/groups/[id]/members
 * ---------------------------------------------------------------------
 * POST   — invite/add a member by email. Returns:
 *            { ok, added: bool, invited: bool }
 *          If the email matches an existing user, they're added as MEMBER.
 *          If not, the email is returned as `invited` so the caller can
 *          surface "user must sign up first" UI.
 * DELETE — remove a member. Owners cannot remove themselves (must
 *          transfer ownership or delete the group). Admins can remove
 *          MEMBERs but not other admins/owners.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

async function getMemberRole(groupId: string, userId: string): Promise<string | null> {
  const m = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { id } = await params;

  const role = await getMemberRole(id, uid);
  if (!role) {
    return NextResponse.json({ error: "Group not found or not a member" }, { status: 404 });
  }
  // Membership changes are a privilege boundary: only OWNER/ADMIN can
  // add members, and only the OWNER can grant the ADMIN role.
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Only owners and admins can add members" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = body.email?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }
  if (body.role === "ADMIN" && role !== "OWNER") {
    return NextResponse.json({ error: "Only the group owner can grant the admin role" }, { status: 403 });
  }
  const newRole = body.role === "ADMIN" ? "ADMIN" : "MEMBER";

  const target = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!target) {
    return NextResponse.json({
      ok: true,
      added: false,
      invited: true,
      email,
      message: "User not found — they need to sign up first.",
    });
  }

  // Check existing membership
  const existing = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: target.id } },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      added: false,
      invited: false,
      message: "Already a member",
    });
  }

  await db.groupMember.create({
    data: { groupId: id, userId: target.id, role: newRole },
  });

  await logAudit({
    userId: uid,
    source: "system",
    event: "group.member_added",
    payload: { groupId: id, addedUserId: target.id, role: newRole },
  });

  return NextResponse.json({ ok: true, added: true, invited: false, email });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { id } = await params;

  const url = new URL(req.url);
  const targetUserId = url.searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing userId query param" }, { status: 400 });
  }

  const role = await getMemberRole(id, uid);
  if (!role) {
    return NextResponse.json({ error: "Group not found or not a member" }, { status: 404 });
  }

  const target = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: targetUserId } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Owners can't remove themselves
  if (targetUserId === uid) {
    return NextResponse.json({ error: "Owners cannot remove themselves. Transfer ownership or delete the group." }, { status: 400 });
  }
  // Admins can only remove MEMBERs, not other admins or owners
  if (role === "ADMIN" && target.role !== "MEMBER") {
    return NextResponse.json({ error: "Admins can only remove regular members" }, { status: 403 });
  }

  await db.groupMember.delete({
    where: { groupId_userId: { groupId: id, userId: targetUserId } },
  });

  await logAudit({
    userId: uid,
    source: "system",
    event: "group.member_removed",
    payload: { groupId: id, removedUserId: targetUserId },
  });

  return NextResponse.json({ ok: true });
}
