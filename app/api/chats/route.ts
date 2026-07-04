/**
 * GET /api/chats — list the current user's chats (most recent first).
 *
 * Includes chats the user owns AND group chats they are a member of.
 *
 * Response shape matches SidebarChat in components/chat/sidebar.tsx:
 *   { chats: [{ id, title, updatedAt, pinned }] }
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const uid = userId!;

  // Owned chats OR group-member chats. Prisma's `OR` clause lets us
  // union these in one query.
  const chats = await db.chat.findMany({
    where: {
      OR: [
        { ownerId: uid },
        { group: { members: { some: { userId: uid } } } },
      ],
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      pinned: true,
      ownerId: true,
      type: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
      pinned: c.pinned,
    })),
  });
}
