/**
 * GLM Power Platform — Skill System
 * ---------------------------------------------------------------------
 * Skills are reusable behavioral wrappers. Three roles:
 *
 *   Maker    — create skills via form OR via chat ("make me a skill that…")
 *   Accepter — import skills from JSON (paste or upload)
 *   Reader   — apply skills to the current chat
 *
 * A skill defines:
 *   - systemPrompt  — the behavioral instructions injected into GLM
 *   - mode          — default execution mode (auto/plan/accept-edits)
 *   - fullBuildOnly — default slop-checker setting
 *   - allowedConnectors / allowedBackends — restrict which integrations
 *     the skill can use
 *   - triggers      — phrases that, when seen in user input, prompt
 *                     the UI to suggest this skill
 *
 * Applied via applyWrappers() in src/lib/ai/client.ts (slot ready —
 * add a skill.id to Chat.settings and the chat route picks it up).
 */

import "@/lib/server-guard";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { parseMode, type ChatMode } from "@/lib/permissions/modes";

export interface SkillData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  mode: ChatMode;
  fullBuildOnly: boolean;
  allowedConnectors: string[];
  allowedBackends: string[];
  triggers: string[];
  version: number;
  origin: "local" | "imported";
  author?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  name: string;
  description: string;
  systemPrompt: string;
  mode?: ChatMode;
  fullBuildOnly?: boolean;
  allowedConnectors?: string[];
  allowedBackends?: string[];
  triggers?: string[];
}

// ---------------------------------------------------------------------
// Maker — create a skill
// ---------------------------------------------------------------------

export async function createSkill(userId: string, input: CreateSkillInput): Promise<SkillData> {
  if (!input.name?.trim()) throw new Error("Skill name required");
  if (!input.systemPrompt?.trim()) throw new Error("System prompt required");

  const row = await db.skill.create({
    data: {
      ownerId: userId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      systemPrompt: input.systemPrompt.trim(),
      mode: parseMode(input.mode),
      fullBuildOnly: input.fullBuildOnly ?? true,
      allowedConnectors: JSON.stringify(input.allowedConnectors ?? []),
      allowedBackends: JSON.stringify(input.allowedBackends ?? []),
      triggers: JSON.stringify(input.triggers ?? []),
      origin: "local",
    },
  });

  await logAudit({
    userId,
    source: "skill",
    event: "skill.created",
    payload: { skillId: row.id, name: row.name },
  });

  return rowToData(row);
}

// ---------------------------------------------------------------------
// Accepter — import a skill from JSON
// ---------------------------------------------------------------------

export async function importSkill(userId: string, json: string): Promise<SkillData> {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON — cannot parse skill");
  }
  if (parsed.type !== "glm-skill" || !parsed.name || !parsed.systemPrompt) {
    throw new Error("JSON is not a valid GLM skill (missing type, name, or systemPrompt)");
  }

  const row = await db.skill.create({
    data: {
      ownerId: userId,
      name: String(parsed.name).slice(0, 200),
      description: String(parsed.description ?? "").slice(0, 1000),
      systemPrompt: String(parsed.systemPrompt),
      mode: parseMode(parsed.mode),
      fullBuildOnly: parsed.fullBuildOnly ?? true,
      allowedConnectors: JSON.stringify(parsed.allowedConnectors ?? []),
      allowedBackends: JSON.stringify(parsed.allowedBackends ?? []),
      triggers: JSON.stringify(parsed.triggers ?? []),
      version: Number(parsed.version ?? 1),
      origin: "imported",
      author: parsed.author ?? null,
    },
  });

  await logAudit({
    userId,
    source: "skill",
    event: "skill.imported",
    payload: { skillId: row.id, name: row.name, author: parsed.author },
  });

  return rowToData(row);
}

// ---------------------------------------------------------------------
// Reader — export a skill as JSON (for sharing)
// ---------------------------------------------------------------------

export async function exportSkill(userId: string, skillId: string): Promise<string> {
  const skill = await db.skill.findFirst({
    where: { id: skillId, ownerId: userId },
  });
  if (!skill) throw new Error("Skill not found");

  return JSON.stringify({
    type: "glm-skill",
    version: skill.version,
    name: skill.name,
    description: skill.description,
    systemPrompt: skill.systemPrompt,
    mode: skill.mode,
    fullBuildOnly: skill.fullBuildOnly,
    allowedConnectors: JSON.parse(skill.allowedConnectors ?? "[]"),
    allowedBackends: JSON.parse(skill.allowedBackends ?? "[]"),
    triggers: JSON.parse(skill.triggers ?? "[]"),
    author: skill.author ?? "anonymous",
  }, null, 2);
}

// ---------------------------------------------------------------------
// List / get / update / delete
// ---------------------------------------------------------------------

export async function listSkills(userId: string): Promise<SkillData[]> {
  const rows = await db.skill.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(rowToData);
}

export async function getSkill(userId: string, skillId: string): Promise<SkillData | null> {
  const row = await db.skill.findFirst({ where: { id: skillId, ownerId: userId } });
  return row ? rowToData(row) : null;
}

export async function updateSkill(userId: string, skillId: string, updates: Partial<CreateSkillInput> & { enabled?: boolean }): Promise<SkillData> {
  const data: Record<string, unknown> = {};
  if (updates.name != null) data.name = updates.name.trim();
  if (updates.description != null) data.description = updates.description.trim();
  if (updates.systemPrompt != null) data.systemPrompt = updates.systemPrompt.trim();
  if (updates.mode != null) data.mode = parseMode(updates.mode);
  if (updates.fullBuildOnly != null) data.fullBuildOnly = updates.fullBuildOnly;
  if (updates.allowedConnectors != null) data.allowedConnectors = JSON.stringify(updates.allowedConnectors);
  if (updates.allowedBackends != null) data.allowedBackends = JSON.stringify(updates.allowedBackends);
  if (updates.triggers != null) data.triggers = JSON.stringify(updates.triggers);
  if (updates.enabled != null) data.enabled = updates.enabled;

  // Verify ownership first — Prisma's `update({ where: { id } })` requires
  // a unique where on `id` only; combining `id + ownerId` throws
  // "Unknown arg `ownerId` in where" at runtime. findFirst verifies the
  // ownership boundary, then we update by id.
  const existing = await db.skill.findFirst({
    where: { id: skillId, ownerId: userId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Skill not found or not owned by user");
  }

  const row = await db.skill.update({
    where: { id: skillId },
    data,
  });
  return rowToData(row);
}

export async function deleteSkill(userId: string, skillId: string): Promise<void> {
  // Same ownership-first pattern as updateSkill — Prisma `delete` only
  // accepts a unique where on `id`; we verify ownership separately.
  const existing = await db.skill.findFirst({
    where: { id: skillId, ownerId: userId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Skill not found or not owned by user");
  }
  await db.skill.delete({ where: { id: skillId } });
  await logAudit({
    userId,
    source: "skill",
    event: "skill.deleted",
    payload: { skillId },
  });
}

// ---------------------------------------------------------------------
// Trigger matching — given user input, find skills that should be suggested
// ---------------------------------------------------------------------

export function matchTriggers(userInput: string, skills: SkillData[]): SkillData[] {
  const lower = userInput.toLowerCase();
  return skills
    .filter((s) => s.enabled)
    .filter((s) => s.triggers.some((t) => lower.includes(t.toLowerCase())))
    .sort((a, b) => b.triggers.length - a.triggers.length);
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function rowToData(row: any): SkillData {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    mode: parseMode(row.mode),
    fullBuildOnly: row.fullBuildOnly,
    allowedConnectors: JSON.parse(row.allowedConnectors ?? "[]"),
    allowedBackends: JSON.parse(row.allowedBackends ?? "[]"),
    triggers: JSON.parse(row.triggers ?? "[]"),
    version: row.version,
    origin: row.origin as "local" | "imported",
    author: row.author,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
