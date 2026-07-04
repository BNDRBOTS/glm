/**
 * GLM Power Platform — Unified Audit Log
 * ---------------------------------------------------------------------
 * Single source of truth for ALL system events. Every module writes
 * here via logAudit(). The LogsPanel UI reads from /api/audit.
 *
 * Sources:
 *   chat         — chat turns, mode changes, gated outputs
 *   voice        — transcription requests + results
 *   connector    — connector test/search/fetch calls
 *   backend      — backend test/query/push calls
 *   quality      — slop detections, retries, warnings
 *   distillation — intent drift, entity extraction
 *   billing      — Stripe events
 *   skill        — skill created/imported/applied/deleted
 *   auth         — sign in, sign out, account created
 *   system       — startup, config errors, health
 *
 * Levels: info | warn | error | debug
 *
 * Log rotation: AuditLog is capped at 10,000 rows per user via the
 * pruneOldLogs() function (called periodically).
 */

import "@/lib/server-guard";
import { db } from "@/lib/db";

export type AuditSource =
  | "chat"
  | "voice"
  | "connector"
  | "backend"
  | "quality"
  | "distillation"
  | "billing"
  | "skill"
  | "auth"
  | "system";

export type AuditLevel = "info" | "warn" | "error" | "debug";

export interface AuditEntry {
  userId?: string | null;
  source: AuditSource;
  level?: AuditLevel;
  event: string;
  payload?: Record<string, unknown>;
  chatId?: string;
}

export interface AuditLogRow {
  id: string;
  userId: string | null;
  source: AuditSource;
  level: AuditLevel;
  event: string;
  payload: Record<string, unknown> | null;
  chatId: string | null;
  createdAt: string;
}

/**
 * Write an audit log entry. Never throws — if DB write fails, the
 * error is swallowed to avoid crashing the calling request.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        source: entry.source,
        level: entry.level ?? "info",
        event: entry.event,
        payload: entry.payload ? JSON.stringify(entry.payload) : null,
        chatId: entry.chatId ?? null,
      },
    });
  } catch (e) {
    // Audit log failure must NEVER crash the calling code path.
    // Surface in stderr for ops, but continue.
    if (process.env.NODE_ENV !== "production") {
      console.error("[audit] write failed:", (e as Error).message);
    }
  }
}

/**
 * Query audit logs. Filters are all optional.
 */
export async function queryAuditLogs(opts: {
  userId?: string;
  source?: AuditSource;
  level?: AuditLevel;
  chatId?: string;
  since?: Date;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (opts.userId) where.userId = opts.userId;
  if (opts.source) where.source = opts.source;
  if (opts.level) where.level = opts.level;
  if (opts.chatId) where.chatId = opts.chatId;
  if (opts.since) where.createdAt = { gte: opts.since };

  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    rows: rows.map(rowToLog),
    total,
  };
}

/**
 * Prune old logs to keep AuditLog table bounded. Default: keep
 * 10,000 most recent per user.
 */
export async function pruneOldLogs(maxPerUser = 10_000): Promise<number> {
  // Get all users with logs
  const users = await db.auditLog.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });

  let totalDeleted = 0;
  for (const u of users) {
    if (!u.userId) continue;
    const count = await db.auditLog.count({ where: { userId: u.userId } });
    if (count <= maxPerUser) continue;

    // Find the cutoff timestamp
    const cutoff = await db.auditLog.findFirst({
      where: { userId: u.userId },
      orderBy: { createdAt: "desc" },
      skip: maxPerUser - 1,
      select: { createdAt: true },
    });
    if (!cutoff) continue;

    const result = await db.auditLog.deleteMany({
      where: {
        userId: u.userId,
        createdAt: { lt: cutoff.createdAt },
      },
    });
    totalDeleted += result.count;
  }
  return totalDeleted;
}

function rowToLog(row: any): AuditLogRow {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source as AuditSource,
    level: row.level as AuditLevel,
    event: row.event,
    payload: row.payload ? safeParse(row.payload) : null,
    chatId: row.chatId,
    createdAt: row.createdAt.toISOString(),
  };
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
