/**
 * GLM Power Platform — Model Catalog
 * ---------------------------------------------------------------------
 * Only the most recent generation. No 4.x models — those are old.
 *
 *   GLM 5.2        — peak reasoning, max tokens, your daily driver
 *   GLM 5.1        — most recent prior release, fast capable
 *   GLM 5.1 Flash  — fastest, for quick lookups and drafts
 *
 * If Z.ai releases a newer model, add it here. The UI auto-picks up
 * every entry in this catalog.
 */

export type ModelTier = "peak" | "fast" | "fastest";

export interface ModelConfig {
  id: string;            // matches what Z.ai API expects
  label: string;         // display label
  tier: ModelTier;       // UX hint
  contextWindow: number; // tokens
  maxOutput: number;     // tokens
  reasoning: boolean;    // does it support extended reasoning?
  description: string;
}

export const MODELS: ModelConfig[] = [
  {
    id: "glm-5.2",
    label: "GLM 5.2",
    tier: "peak",
    contextWindow: 128_000,
    maxOutput: 16_000,
    reasoning: true,
    description: "Peak reasoning. Full token limits. Maximum depth. Your daily driver.",
  },
  {
    id: "glm-5.1",
    label: "GLM 5.1",
    tier: "fast",
    contextWindow: 128_000,
    maxOutput: 12_000,
    reasoning: true,
    description: "Most recent prior release. Still strong reasoning, slightly faster than 5.2.",
  },
  {
    id: "glm-5.1-flash",
    label: "GLM 5.1 Flash",
    tier: "fastest",
    contextWindow: 128_000,
    maxOutput: 6_000,
    reasoning: false,
    description: "Fastest in the 5.x line. Quick lookups, drafts, trivial edits.",
  },
];

const DEFAULT_MODEL = "glm-5.2";

export function getModel(id: string): ModelConfig | undefined {
  return MODELS.find((m) => m.id === id);
}
