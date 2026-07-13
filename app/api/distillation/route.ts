/**
 * GET /api/distillation?chatId=...
 * ---------------------------------------------------------------------
 * Returns the live distillation state for a chat so the UI can restore
 * the intent-drift badge after a reload or chat switch (the SSE stream
 * only delivers updates while a message is in flight).
 *
 * Access: requester must own or be a member of the chat. Returns
 * { state: null } when no state exists (expired TTL or brand-new chat)
 * — the badge simply stays hidden until the next turn re-bootstraps.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";
import { getDistillationState } from "@/lib/distillation/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
  }

  const chat = await db.chat.findFirst({
    where: {
      id: chatId,
      OR: [
        { ownerId: userId! },
        { group: { members: { some: { userId: userId! } } } },
      ],
    },
    select: { id: true },
  });
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const state = await getDistillationState(chatId);
  if (!state) {
    return NextResponse.json({ state: null });
  }

  // Same summary shape as the SSE "distillation" event.
  return NextResponse.json({
    state: {
      overallAlignment: state.overallAlignment,
      driftDetected: state.driftDetected,
      entityCount: state.entities.length,
      factCount: state.facts.length,
      decisionCount: state.decisions.length,
      actionItemCount: state.actionItems.length,
      openQuestionCount: state.openQuestions.length,
      originalIntent: state.originalIntent,
      lastUpdated: state.lastUpdated,
    },
  });
}
