/**
 * GLM Power Platform — Memory System
 * ---------------------------------------------------------------------
 * Turn-by-turn JSON logging. Every turn is persisted to MemoryLog.
 * Context is never dropped mid-session — the next turn always sees
 * the full prior log via loadTurnsForChat().
 *
 * Two export buttons live at the end of a chat:
 *   1. Raw export       — every message as JSON
 *   2. Deep aggregate   — facts, entities, summary, action items
 *
 * The "deep aggregate" today uses a deterministic local extractor.
 * Tomorrow: swap extractDeep() with a Pinecone-backed semantic mesh —
 * the interface stays identical (DeepAggregateResult), nothing else
 * in the app needs to change.
 */

import { db } from "@/lib/db";

export interface TurnRecord {
  messageId: string;
  chatId: string;
  /** Who authored the turn — null for assistant/system turns. */
  authorId: string | null;
  /**
   * Which user's memory this turn belongs to (the chat owner /
   * effective user). Kept separate from authorId so assistant turns
   * are never misattributed to the human user in the journal.
   */
  ownerId?: string | null;
  role: string;
  content: string;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  timestamp: string;
  factsExtracted?: string[];
  entities?: string[];
  /** True when the turn was cut short (client abort / stream error). */
  truncated?: boolean;
}

export interface DeepAggregateResult {
  chatId: string;
  generatedAt: string;
  summary: string;
  facts: string[];
  entities: string[];
  actionItems: string[];
  openQuestions: string[];
  decisions: string[];
  rawTurnCount: number;
}

/**
 * Persist a turn record. Called after every assistant or user message.
 *
 * NEVER throws. The Message table is the authoritative transcript;
 * MemoryLog is the secondary journal that feeds extractDeep(). A
 * journal write failure must not abort the chat turn — but it must
 * not be silent either, so failures are surfaced to the AuditLog
 * (and stderr as a last resort).
 *
 * The MemoryLog row is keyed by the memory OWNER (rec.ownerId,
 * falling back to rec.authorId). Rows are never written with a
 * synthetic non-existent user id — MemoryLog.userId has a foreign key
 * to User, and a fake id would make the write fail on every turn.
 */
export async function logTurn(rec: Omit<TurnRecord, "timestamp">): Promise<void> {
  const ownerId = rec.ownerId ?? rec.authorId;
  try {
    if (!ownerId) {
      throw new Error("logTurn requires ownerId or authorId to scope the memory row");
    }
    const payload = JSON.stringify({ ...rec, ownerId, timestamp: new Date().toISOString() });
    await db.memoryLog.create({
      data: {
        userId: ownerId,
        chatId: rec.chatId,
        payload,
        kind: "TURN",
      },
    });
  } catch (e) {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit({
        userId: ownerId ?? null,
        source: "system",
        level: "error",
        event: "memory.turn_log_failed",
        payload: { chatId: rec.chatId, messageId: rec.messageId, role: rec.role, error: String(e) },
        chatId: rec.chatId,
      });
    } catch {
      console.error(`[memory] turn log failed for chat ${rec.chatId}: ${String(e)}`);
    }
  }
}

/**
 * Load every turn for a chat, oldest-first.
 * This is what feeds back into the next AI turn so context never drops.
 */
async function loadTurnsForChat(chatId: string): Promise<TurnRecord[]> {
  const logs = await db.memoryLog.findMany({
    where: { chatId, kind: "TURN" },
    orderBy: { createdAt: "asc" },
  });
  return logs.map((l) => JSON.parse(l.payload) as TurnRecord);
}

/**
 * Extract facts/entities locally (deterministic).
 *
 * SWAP POINT: replace this with a Pinecone-powered semantic mesh later.
 * Keep the return type (DeepAggregateResult) so the rest of the app
 * doesn't change.
 */
export async function extractDeep(chatId: string): Promise<DeepAggregateResult> {
  const turns = await loadTurnsForChat(chatId);

  const facts: string[] = [];
  const entities: string[] = [];
  const actionItems: string[] = [];
  const openQuestions: string[] = [];
  const decisions: string[] = [];

  // Deterministic heuristics — good enough baseline, easy to upgrade.
  const entityRe = /\b([A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]+)*)\b/g;
  const factKeywords = ["is ", "are ", "was ", "were ", "means ", "defined as ", "equals "];
  const actionRe = /\b(?:should|must|need to|todo|action:|next step:|will|going to)\b[^.!?]*[.!?]/gi;
  const questionRe = /\b(?:what|why|how|when|where|who|which)\b[^.!?]*\?/gi;
  const decisionRe = /\b(?:decided|chose|agreed|concluded|final answer:|verdict:)\b[^.!?]*[.!?]/gi;

  for (const t of turns) {
    if (t.role !== "assistant" && t.role !== "user") continue;
    const content = t.content;

    // Entities (named-capitalized tokens, deduped)
    let m: RegExpExecArray | null;
    while ((m = entityRe.exec(content)) !== null) {
      const e = m[1].trim();
      if (!["The", "This", "That", "These", "Those", "It", "We", "You", "I"].includes(e)) {
        if (!entities.includes(e)) entities.push(e);
      }
    }

    // Facts — sentences containing definitional keywords
    const sentences = content.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const lower = s.toLowerCase();
      if (factKeywords.some((k) => lower.includes(k)) && s.length > 20 && s.length < 280) {
        if (!facts.includes(s.trim())) facts.push(s.trim());
      }
      const qMatch = s.match(questionRe);
      if (qMatch) for (const q of qMatch) if (!openQuestions.includes(q)) openQuestions.push(q);
      const aMatch = s.match(actionRe);
      if (aMatch) for (const a of aMatch) if (!actionItems.includes(a)) actionItems.push(a);
      const dMatch = s.match(decisionRe);
      if (dMatch) for (const d of dMatch) if (!decisions.includes(d)) decisions.push(d);
    }
  }

  const summary = turns
    .slice(-3)
    .map((t) => `${t.role}: ${t.content.slice(0, 200)}`)
    .join("\n\n");

  return {
    chatId,
    generatedAt: new Date().toISOString(),
    summary,
    facts: facts.slice(0, 50),
    entities: entities.slice(0, 80),
    actionItems: actionItems.slice(0, 30),
    openQuestions: openQuestions.slice(0, 30),
    decisions: decisions.slice(0, 30),
    rawTurnCount: turns.length,
  };
}

/**
 * Raw chat export — every message, no transformation.
 * Includes authorship, the structured turnLog, and thread pointers so
 * the export is a complete, verbatim record of the stored transcript
 * (not a lossy projection of it).
 */
export async function exportRaw(chatId: string) {
  const messages = await db.message.findMany({
    where: { chatId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { attachments: true },
  });
  return {
    chatId,
    exportedAt: new Date().toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      authorId: m.authorId,
      content: m.content,
      model: m.model,
      turnLog: safeParseJson(m.turnLog),
      toolCalls: safeParseJson(m.toolCalls),
      parentMessageId: m.parentMessageId,
      tokens: {
        prompt: m.promptTokens,
        completion: m.completionTokens,
        total: m.totalTokens,
      },
      attachments: m.attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        storage: a.storage,
        storageKey: a.storageKey,
      })),
      createdAt: m.createdAt,
    })),
  };
}

/** Parse a stored JSON column; return the raw string if it isn't valid JSON. */
function safeParseJson(s: string | null): unknown {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
