/**
 * /api/chats/[id]
 * ---------------------------------------------------------------------
 * GET    — load chat + messages (ownership / membership checked)
 * PATCH  — rename chat (title)
 * PUT    — toggle pin
 * DELETE — delete chat (only owner can delete; group chats require
 *          group OWNER role)
 *
 * All mutations verify access via getAccessibleChat() — same boundary
 * as the GET route.
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
    select: {
      id: true,
      title: true,
      model: true,
      type: true,
      settings: true,
      systemPrompt: true,
      updatedAt: true,
      ownerId: true,
      groupId: true,
      pinned: true,
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { id } = await params;

  const chat = await getAccessibleChat(id, uid);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const messages = await db.message.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      totalTokens: true,
      thinking: true,
      sources: true,
      createdAt: true,
      authorId: true,
    },
  });

  let mode: "auto" | "plan" | "accept-edits" = "auto";
  let fullBuildOnly = false;
  if (chat.settings) {
    try {
      const parsed = JSON.parse(chat.settings);
      if (parsed.mode) mode = parsed.mode;
      if (typeof parsed.fullBuildOnly === "boolean") fullBuildOnly = parsed.fullBuildOnly;
    } catch {
      // ignore malformed settings
    }
  }

  return NextResponse.json({
    chat: {
      id: chat.id,
      title: chat.title,
      model: chat.model,
      type: chat.type,
      mode,
      fullBuildOnly,
      systemPrompt: chat.systemPrompt,
      updatedAt: chat.updatedAt.toISOString(),
      pinned: chat.pinned,
    },
    messages: messages.map((m) => {
      let sources: unknown = null;
      if (m.sources) {
        try { sources = JSON.parse(m.sources); } catch { /* malformed — omit */ }
      }
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        tokens: m.totalTokens,
        thinking: m.thinking,
        sources,
        createdAt: m.createdAt.toISOString(),
        authorId: m.authorId,
      };
    }),
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

  const chat = await getAccessibleChat(id, uid);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    model?: string;
    mode?: "auto" | "plan" | "accept-edits";
    fullBuildOnly?: boolean;
    systemPrompt?: string | null;
  };

  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 200);
  }
  if (typeof body.model === "string" && body.model.trim()) {
    data.model = body.model.trim();
  }
  if (body.mode || typeof body.fullBuildOnly === "boolean" || body.systemPrompt !== undefined) {
    // Merge settings JSON
    let settings: Record<string, unknown> = {};
    if (chat.settings) {
      try { settings = JSON.parse(chat.settings); } catch {}
    }
    if (body.mode) settings.mode = body.mode;
    if (typeof body.fullBuildOnly === "boolean") settings.fullBuildOnly = body.fullBuildOnly;
    data.settings = JSON.stringify(settings);
  }
  if (body.systemPrompt !== undefined) {
    data.systemPrompt = body.systemPrompt;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await db.chat.update({
    where: { id },
    data,
    select: { id: true, title: true, model: true, settings: true, pinned: true, updatedAt: true },
  });

  return NextResponse.json({
    chat: {
      id: updated.id,
      title: updated.title,
      model: updated.model,
      pinned: updated.pinned,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { id } = await params;

  const chat = await getAccessibleChat(id, uid);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { pinned?: boolean };
  if (typeof body.pinned !== "boolean") {
    return NextResponse.json({ error: "Missing pinned boolean" }, { status: 400 });
  }

  const updated = await db.chat.update({
    where: { id },
    data: { pinned: body.pinned },
    select: { id: true, pinned: true },
  });
  return NextResponse.json({ chat: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const uid = userId!;
  const { id } = await params;

  // Deletion is owner-only. Group members can read but not delete.
  const chat = await db.chat.findFirst({
    where: { id, ownerId: uid },
    select: { id: true },
  });
  if (!chat) {
    return NextResponse.json({ error: "Chat not found or not owned by you" }, { status: 404 });
  }

  await db.chat.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
