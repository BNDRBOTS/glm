/**
 * GET /api/dashboard
 * Returns token usage stats for the dashboard widget.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const uid = userId!;

  const [totalAgg, byModelAgg, recent] = await Promise.all([
    db.usageLog.aggregate({
      where: { userId: uid },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, costCents: true },
      _count: true,
    }),
    db.usageLog.groupBy({
      by: ["model"],
      where: { userId: uid },
      _sum: { totalTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
    }),
    db.usageLog.findMany({
      where: { userId: uid },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { chat: { select: { title: true } } },
    }),
  ]);

  return NextResponse.json({
    totals: {
      promptTokens: totalAgg._sum.promptTokens ?? 0,
      completionTokens: totalAgg._sum.completionTokens ?? 0,
      totalTokens: totalAgg._sum.totalTokens ?? 0,
      costCents: totalAgg._sum.costCents ?? 0,
      requestCount: totalAgg._count,
    },
    byModel: byModelAgg.map((m) => ({
      model: m.model,
      totalTokens: m._sum.totalTokens ?? 0,
      requestCount: m._count,
    })),
    recent: recent.map((r) => ({
      id: r.id,
      model: r.model,
      totalTokens: r.totalTokens,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      chatTitle: r.chat?.title,
      createdAt: r.createdAt,
    })),
  });
}
