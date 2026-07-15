/**
 * GET /api/skills/[id]/export
 * ---------------------------------------------------------------------
 * Export a skill as shareable JSON (owner only). The receiving side
 * imports it via POST /api/skills { action: "import", json }.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { exportSkill } from "@/lib/skills";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  try {
    const json = await exportSkill(userId!, id);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="skill-${id}.json"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
