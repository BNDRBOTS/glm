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
 *   rag          — document ingest lifecycle + retrieval events
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
  | "system"
  | "rag";

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
 *
 * Auto-prune: roughly 1 in 500 writes triggers a fire-and-forget
 * per-user prune so the "last 10K per user" cap is actually enforced
 * during normal operation, not only when someone remembers to hit
 * DELETE /api/audit.
 */
const AUTO_PRUNE_PROBABILITY = 1 / 500;

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
    if (entry.userId && Math.random() < AUTO_PRUNE_PROBABILITY) {
      // Deliberately not awaited — pruning must never add latency to
      // the calling request. Errors are swallowed (next write retries).
      void pruneUserLogs(entry.userId).catch(() => {});
    }
  } catch (e) {
    // Audit log failure must NEVER crash the calling code path.
    // Surface in stderr for ops, but continue.
    if (process.env.NODE_ENV !== "production") {
      console.error("[audit] write failed:", (e as Error).message);
    }
  }
}

/**
 * Prune audit logs for a single user — keep the most recent
 * `maxPerUser`. Safe for multi-tenant callers (only touches one
 * user's rows). Used by the auto-prune above and DELETE /api/audit.
 */
export async function pruneUserLogs(userId: string, maxPerUser = 10_000): Promise<number> {
  const count = await db.auditLog.count({ where: { userId } });
  if (count <= maxPerUser) return 0;
  const cutoff = await db.auditLog.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: maxPerUser - 1,
    select: { createdAt: true },
  });
  if (!cutoff) return 0;
  const result = await db.auditLog.deleteMany({
    where: { userId, createdAt: { lt: cutoff.createdAt } },
  });
  return result.count;
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
    totalDeleted += await pruneUserLogs(u.userId, maxPerUser);
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
