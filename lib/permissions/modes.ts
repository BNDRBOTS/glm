/**
 * GLM Power Platform — Permissions System
 * ---------------------------------------------------------------------
 * Three modes per chat:
 *
 *   auto          — AI executes end-to-end. Slop checker still runs.
 *   plan          — AI must produce a plan first; user approves
 *                   before any execution. Each plan step is gated.
 *   accept-edits  — AI proposes edits as diffs; user accepts each.
 *
 * Plus a "full-build-only" preset: when active, the silent AI checker
 * rejects any output that contains placeholders, partial
 * implementations, or diversions from the original spec.
 *
 * Modes are persisted per-chat in the Chat.settings JSON field
 * (key: `mode`). Default mode is `auto`.
 */

export type ChatMode = "auto" | "plan" | "accept-edits";

export const MODES: { id: ChatMode; label: string; description: string }[] = [
  {
    id: "auto",
    label: "Auto",
    description: "AI executes end-to-end. Slop checker still gates delivery.",
  },
  {
    id: "plan",
    label: "Plan",
    description: "AI must produce a plan first. You approve before execution.",
  },
  {
    id: "accept-edits",
    label: "Accept Edits",
    description: "AI proposes edits as diffs. You accept each one.",
  },
];

const DEFAULT_MODE: ChatMode = "auto";

export function parseMode(s: unknown): ChatMode {
  if (s === "plan" || s === "accept-edits" || s === "auto") return s;
  return DEFAULT_MODE;
}

/**
 * Mode gate: given the current mode and a proposed AI action, decide
 * whether to deliver immediately, require approval, or reject.
 */
export type GateDecision =
  | { action: "deliver" }
  | { action: "require-plan-approval"; plan: string }
  | { action: "require-edit-approval"; diff: string }
  | { action: "reject"; reason: string };

export interface GateInput {
  mode: ChatMode;
  output: string;
  fullBuildOnly: boolean;
  isPlanStep?: boolean;
  hasUserApprovedPlan?: boolean;
}

export function modeGate(input: GateInput): GateDecision {
  // 1. Full-build-only check fires regardless of mode
  if (input.fullBuildOnly) {
    const slop = detectSlopPatterns(input.output);
    if (slop.length > 0) {
      return {
        action: "reject",
        reason: `Output contains slop patterns: ${slop.join(", ")}. Retry required.`,
      };
    }
  }

  // 2. Mode-specific gating
  switch (input.mode) {
    case "auto":
      return { action: "deliver" };

    case "plan":
      // If this is a plan step and user hasn't approved, hold for approval
      if (input.isPlanStep && !input.hasUserApprovedPlan) {
        return {
          action: "require-plan-approval",
          plan: input.output,
        };
      }
      return { action: "deliver" };

    case "accept-edits":
      // In accept-edits mode, every output is treated as a diff to approve
      return {
        action: "require-edit-approval",
        diff: input.output,
      };
  }
}

/**
 * Slop pattern detection — used by both the gate and the silent
 * AI checker. Returns list of detected slop types.
 */
export function detectSlopPatterns(text: string): string[] {
  const found: string[] = [];

  // Placeholders
  if (/\b(TODO|FIXME|XXX|HACK)\b/.test(text)) found.push("todo-marker");
  if (/<placeholder>/i.test(text)) found.push("placeholder-tag");
  if (/\bimplement later\b/i.test(text)) found.push("implement-later");
  if (/\bYOUR_API_KEY\b|\bYOUR_TOKEN\b|\bREPLACE_ME\b/.test(text)) found.push("fake-credentials");

  // Empty implementations
  if (/\{\s*\}/.test(text) && !/\{\s*return\s/.test(text)) {
    // Only flag empty function bodies, not empty object literals
    if (/\)\s*\{\s*\}/.test(text)) found.push("empty-function-body");
  }
  if (/throw new (Error|NotImplementedError)\(["']not implemented["']\)/i.test(text)) {
    found.push("not-implemented-throw");
  }
  if (/pass\b/i.test(text) && /def\s+\w+/.test(text)) found.push("python-pass-stub");

  // Partial implementations
  if (/\bcontinue here\b/i.test(text)) found.push("continue-here");
  if (/\brest of (the )?code\b/i.test(text)) found.push("rest-of-code");
  if (/\.\.\.\s*$/.test(text.trim()) && /function|def|class/.test(text)) {
    found.push("ellipsis-truncation");
  }

  // Diversions from intent (heuristic — if the response is mostly
  // meta-commentary about what the AI would do rather than doing it)
  const lines = text.split("\n").filter(Boolean);
  const metaLines = lines.filter((l) =>
    /^(I would|I'll|Let me|Here's how|To do this|First,? I|Next,? I|The approach)/i.test(l.trim())
  );
  if (lines.length > 4 && metaLines.length / lines.length > 0.6) {
    found.push("meta-heavy-no-substance");
  }

  // Fake imports (common AI hallucination)
  const importMatches = text.matchAll(/import\s+\{[^}]+\}\s+from\s+['"]([a-z@][^'"]+)['"]/g);
  const knownSuspicious = ["react-magic", "next-super", "ai-utils", "auto-coder", "magic-lib"];
  for (const m of importMatches) {
    if (knownSuspicious.includes(m[1])) found.push(`fake-import:${m[1]}`);
  }

  return found;
}
