/**
 * /api/skills/[id]
 * ---------------------------------------------------------------------
 * GET    — fetch one skill (owner only)
 * PUT    — update fields / toggle enabled (owner only)
 * DELETE — delete the skill (owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getSkill, updateSkill, deleteSkill, type CreateSkillInput } from "@/lib/skills";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  const skill = await getSkill(userId!, id);
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  return NextResponse.json({ skill });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as Partial<CreateSkillInput> & {
    enabled?: boolean;
  };

  try {
    const skill = await updateSkill(userId!, id, body);
    return NextResponse.json({ skill });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /not found/i.test(msg) ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  try {
    await deleteSkill(userId!, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /not found/i.test(msg) ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
