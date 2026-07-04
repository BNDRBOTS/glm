/**
 * POST /api/exports
 * Body: { chatId, type: "raw" | "aggregated" }
 * Returns JSON for download.
 *
 * SECURITY: Both POST + GET require an authenticated user (or demo
 * mode in dev) AND verify that the requester owns or is a member of
 * the chat identified by chatId. Previously this endpoint hardcoded
 * userId: "demo-user" and let anyone export any chat by id.
 */

import { NextRequest, NextResponse } from "next/server";
import { exportRaw, extractDeep } from "@/lib/memory";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

/**
 * Verify that the user can access the given chat — either as owner
 * or as a member of the chat's group (if the chat is a GROUP chat).
 * Returns the chat row or null.
 */
async function getAccessibleChat(chatId: string, userId: string) {
  return db.chat.findFirst({
    where: {
      id: chatId,
      OR: [
        { ownerId: userId },
        { group: { members: { some: { userId } } } },
      ],
    },
    select: { id: true, ownerId: true, groupId: true, type: true },
  });
}

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const { chatId, type } = (await req.json()) as { chatId: string; type: "raw" | "aggregated" };

  if (!chatId) return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
  if (type !== "raw" && type !== "aggregated") {
    return NextResponse.json({ error: "Invalid type — must be 'raw' or 'aggregated'" }, { status: 400 });
  }

  // Ownership / membership check
  const chat = await getAccessibleChat(chatId, userId!);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found or not accessible" }, { status: 404 });
  }

  if (type === "aggregated") {
    const result = await extractDeep(chatId);
    await db.chatExport.create({
      data: {
        chatId,
        userId: userId!,
        type: "aggregated",
        payload: JSON.stringify(result),
      },
    });
    return NextResponse.json(result, {
      headers: {
        "Content-Disposition": `attachment; filename="chat-${chatId}-aggregate.json"`,
      },
    });
  }

  const raw = await exportRaw(chatId);
  await db.chatExport.create({
    data: {
      chatId,
      userId: userId!,
      type: "raw",
      payload: JSON.stringify(raw),
    },
  });
  return NextResponse.json(raw, {
    headers: {
      "Content-Disposition": `attachment; filename="chat-${chatId}-raw.json"`,
    },
  });
}

/**
 * GET /api/exports?chatId=... — list past exports for a chat the
 * requesting user can access.
 */
export async function GET(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "Missing chatId" }, { status: 400 });

  const chat = await getAccessibleChat(chatId, userId!);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found or not accessible" }, { status: 404 });
  }

  // Only return exports owned by THIS user (a group member shouldn't
  // see another member's export history unless explicitly shared).
  const rows = await db.chatExport.findMany({
    where: { chatId, userId: userId! },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ exports: rows });
}
