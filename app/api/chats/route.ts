/**
 * GET /api/chats — list the current user's chats (most recent first).
 *
 * Includes chats the user owns AND group chats they are a member of.
 *
 * Response shape matches SidebarChat in components/chat/sidebar.tsx:
 *   { chats: [{ id, title, updatedAt, pinned }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const uid = userId!;

  // Pagination: default page size matches the old fixed cap (100) so
  // existing clients see identical behavior, but chats past the cap
  // are no longer silently unreachable — callers can page with
  // ?limit=&offset= and use `total` to know when to stop.
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 100);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 500) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;

  // Owned chats OR group-member chats. Prisma's `OR` clause lets us
  // union these in one query.
  const where = {
    OR: [
      { ownerId: uid },
      { group: { members: { some: { userId: uid } } } },
    ],
  };
  const [chats, total] = await Promise.all([
    db.chat.findMany({
      where,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        pinned: true,
        ownerId: true,
        type: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.chat.count({ where }),
  ]);

  return NextResponse.json({
    total,
    limit,
    offset,
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
      pinned: c.pinned,
    })),
  });
}
