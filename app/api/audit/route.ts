/**
 * Audit log API
 * GET /api/audit?source=...&level=...&chatId=...&limit=...&offset=...
 *   — query unified audit log (scoped to the requesting user)
 * DELETE /api/audit — prune old logs (keep last 10K per user).
 *   In demo mode, prune is restricted to demo-user's logs only — never
 *   touches other users' audit trails.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAuditLogs, pruneUserLogs, type AuditSource, type AuditLevel } from "@/lib/audit";
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
  // User-scoped prune only — one user must never be able to delete
  // another's audit trail. (lib/audit's pruneOldLogs iterates all
  // users and is reserved for operator scripts.)
  const deleted = await pruneUserLogs(userId!);
  return NextResponse.json({ pruned: deleted });
}
