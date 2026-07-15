/**
 * /api/skills
 * ---------------------------------------------------------------------
 * GET  — list the current user's skills
 * POST — { action: "create", ...CreateSkillInput }  → create a skill
 *        { action: "import", json: string }         → import from JSON
 *
 * These routes are the server side of the skills panel (maker /
 * accepter / reader). All operations are scoped to the requesting
 * user — skills never leak across accounts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { listSkills, createSkill, importSkill, type CreateSkillInput } from "@/lib/skills";
import type { ChatMode } from "@/lib/permissions/modes";

export const runtime = "nodejs";

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const skills = await listSkills(userId!);
  return NextResponse.json({ skills });
}

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    action?: "create" | "import";
    json?: string;
    name?: string;
    description?: string;
    systemPrompt?: string;
    mode?: ChatMode;
    fullBuildOnly?: boolean;
    allowedConnectors?: string[];
    allowedBackends?: string[];
    triggers?: string[];
  };

  try {
    if (body.action === "import") {
      if (!body.json || typeof body.json !== "string") {
        return NextResponse.json({ error: "Missing skill JSON" }, { status: 400 });
      }
      const skill = await importSkill(userId!, body.json);
      return NextResponse.json({ skill });
    }

    // Default action: create
    const input: CreateSkillInput = {
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      systemPrompt: String(body.systemPrompt ?? ""),
      mode: body.mode,
      fullBuildOnly: typeof body.fullBuildOnly === "boolean" ? body.fullBuildOnly : undefined,
      allowedConnectors: Array.isArray(body.allowedConnectors) ? body.allowedConnectors.map(String) : undefined,
      allowedBackends: Array.isArray(body.allowedBackends) ? body.allowedBackends.map(String) : undefined,
      triggers: Array.isArray(body.triggers) ? body.triggers.map(String) : undefined,
    };
    const skill = await createSkill(userId!, input);
    return NextResponse.json({ skill });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
