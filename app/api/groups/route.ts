/**
 * /api/groups
 * ---------------------------------------------------------------------
 * GET  — list groups the requester is a member of
 * POST — create a new group (requester becomes OWNER)
 *
 * Body for POST: { name, description?, slug?, memberEmails?: string[] }
 *   - slug is auto-generated from name if omitted
 *   - memberEmails: looks up existing users by email and adds them as
 *     MEMBER. Non-existent emails are returned as `invited` so the
 *     caller can show "user must sign up first" UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "group";
}

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;

  const groups = await db.group.findMany({
    where: { members: { some: { userId: uid } } },
    include: {
      members: { select: { id: true, userId: true, role: true, user: { select: { email: true, name: true } } } },
      _count: { select: { chats: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      description: g.description,
      stripeCustomerId: g.stripeCustomerId,
      stripeSubscriptionId: g.stripeSubscriptionId,
      createdAt: g.createdAt.toISOString(),
      members: g.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        name: m.user.name,
      })),
      chatCount: g._count.chats,
    })),
  });
}

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    slug?: string;
    memberEmails?: string[];
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Group name required" }, { status: 400 });
  }

  const name = body.name.trim().slice(0, 100);
  let slug = body.slug?.trim() ? slugify(body.slug) : slugify(name);

  // Ensure slug uniqueness
  let suffix = 0;
  while (await db.group.findUnique({ where: { slug } })) {
    suffix++;
    slug = `${slugify(name)}-${suffix}`;
  }

  // Resolve member emails → user ids
  const memberEmails = (body.memberEmails ?? [])
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
  const invited: string[] = [];
  const memberRows: { userId: string; role: string }[] = [];

  if (memberEmails.length > 0) {
    const users = await db.user.findMany({
      where: { email: { in: memberEmails } },
      select: { id: true, email: true },
    });
    const found = new Map(users.map((u) => [u.email, u.id]));
    for (const email of memberEmails) {
      const id = found.get(email);
      if (id) memberRows.push({ userId: id, role: "MEMBER" });
      else invited.push(email);
    }
  }

  const group = await db.group.create({
    data: {
      name,
      slug,
      description: body.description?.trim().slice(0, 500) ?? null,
      members: {
        create: [
          { userId: uid, role: "OWNER" },
          ...memberRows,
        ],
      },
    },
    include: {
      members: { select: { userId: true, role: true, user: { select: { email: true, name: true } } } },
    },
  });

  await logAudit({
    userId: uid,
    source: "system",
    event: "group.created",
    payload: { groupId: group.id, name: group.name, memberCount: group.members.length, invited },
  });

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      createdAt: group.createdAt.toISOString(),
      members: group.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        name: m.user.name,
      })),
    },
    invited,
  });
}
