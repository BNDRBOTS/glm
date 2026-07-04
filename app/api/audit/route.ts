/**
 * Audit log API
 * GET /api/audit?source=...&level=...&chatId=...&limit=...&offset=...
 *   — query unified audit log (scoped to the requesting user)
 * DELETE /api/audit — prune old logs (keep last 10K per user).
 *   In demo mode, prune is restricted to demo-user's logs only — never
 *   touches other users' audit trails.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAuditLogs, pruneOldLogs, type AuditSource, type AuditLevel } from "@/lib/audit";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const url = new URL(req.url);
  const source = url.searchParams.get("source") as AuditSource | null;
  const level = url.searchParams.get("level") as AuditLevel | null;
  const chatId = url.searchParams.get("chatId") ?? undefined;
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (sinceParam && isNaN(since!.getTime())) {
    return NextResponse.json({ error: "Invalid 'since' parameter" }, { status: 400 });
  }
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
  const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

  const result = await queryAuditLogs({
    userId: userId!,
    source: source ?? undefined,
    level: level ?? undefined,
    chatId,
    since,
    limit,
    offset,
  });

  return NextResponse.json(result);
}

export async function DELETE() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  // pruneOldLogs currently iterates ALL users in the DB. Restrict to
  // the requesting user's logs to prevent one user from deleting
  // another's audit trail. The lib function is per-user already —
  // we pass userId to scope it explicitly.
  const deleted = await pruneOldLogsForUser(userId!);
  return NextResponse.json({ pruned: deleted });
}

/**
 * Prune audit logs for a single user — keep last 10,000.
 * This is a user-scoped variant of pruneOldLogs; the lib version
 * iterates ALL users which is unsafe for a multi-tenant endpoint.
 */
async function pruneOldLogsForUser(userId: string, maxPerUser = 10_000): Promise<number> {
  const { db } = await import("@/lib/db");
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
