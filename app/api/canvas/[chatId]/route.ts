/**
 * /api/canvas/[chatId]
 * ---------------------------------------------------------------------
 * GET    — list canvas snapshots for a chat (newest first)
 * POST   — save a new snapshot
 *
 * Access: requester must own or be a member of the chat.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

async function getAccessibleChat(chatId: string, userId: string) {
  return db.chat.findFirst({
    where: {
      id: chatId,
      OR: [
        { ownerId: userId },
        { group: { members: { some: { userId } } } },
      ],
    },
    select: { id: true },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { chatId } = await params;

  const chat = await getAccessibleChat(chatId, uid);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const snapshots = await db.canvasState.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      kind: true,
      source: true,
      parentId: true,
      messageId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    snapshots: snapshots.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { chatId } = await params;

  const chat = await getAccessibleChat(chatId, uid);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    kind?: "html" | "react";
    source?: string;
    parentId?: string;
    messageId?: string;
  };

  if (typeof body.source !== "string" || !body.source.trim()) {
    return NextResponse.json({ error: "Missing source" }, { status: 400 });
  }
  const kind = body.kind === "react" ? "react" : "html";

  // Cap source size to prevent abuse (1 MB).
  if (body.source.length > 1_000_000) {
    return NextResponse.json({ error: "Source too large (max 1 MB)" }, { status: 413 });
  }

  const row = await db.canvasState.create({
    data: {
      chatId,
      kind,
      source: body.source,
      parentId: body.parentId ?? null,
      messageId: body.messageId ?? null,
    },
    select: { id: true, kind: true, source: true, createdAt: true },
  });

  return NextResponse.json({
    snapshot: { ...row, createdAt: row.createdAt.toISOString() },
  });
}
