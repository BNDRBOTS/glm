/**
 * /api/groups/[id]
 * ---------------------------------------------------------------------
 * GET    — group detail (members, chats)
 * PATCH  — rename / update description (OWNER or ADMIN only)
 * DELETE — delete group (OWNER only)
 *
 * Membership access verified on every route.
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

export async function GET(
  _req: NextRequest,
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

  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: {
        select: { id: true, userId: true, role: true, createdAt: true, user: { select: { email: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      chats: {
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      stripeCustomerId: group.stripeCustomerId,
      stripeSubscriptionId: group.stripeSubscriptionId,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      members: group.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        name: m.user.name,
        joinedAt: m.createdAt.toISOString(),
      })),
      chats: group.chats.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt.toISOString(),
      })),
      yourRole: role,
    },
  });
}

export async function PATCH(
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
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Only owners and admins can edit the group" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string | null;
  };

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim().slice(0, 100);
  }
  if (body.description !== undefined) {
    data.description = body.description?.trim().slice(0, 500) ?? null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await db.group.update({
    where: { id },
    data,
    select: { id: true, name: true, description: true, updatedAt: true },
  });

  await logAudit({
    userId: uid,
    source: "system",
    event: "group.updated",
    payload: { groupId: id, fields: Object.keys(data) },
  });

  return NextResponse.json({ group: { ...updated, updatedAt: updated.updatedAt.toISOString() } });
}

export async function DELETE(
  _req: NextRequest,
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
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Only the group owner can delete the group" }, { status: 403 });
  }

  await db.group.delete({ where: { id } });

  await logAudit({
    userId: uid,
    source: "system",
    event: "group.deleted",
    payload: { groupId: id },
  });

  return NextResponse.json({ ok: true });
}
