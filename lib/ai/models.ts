/**
 * Model Catalog — GLM (Z.ai) + DeepSeek, merged.
 * ---------------------------------------------------------------------
 * Only the most recent generation of each line. No 4.x GLM models.
 *
 *   GLM 5.2            — peak reasoning, max tokens, your daily driver
 *   GLM 5.1            — most recent prior release, fast capable
 *   GLM 5.1 Flash      — fastest, for quick lookups and drafts
 *   DeepSeek Reasoner  — R1-series reasoning with a visible thinking
 *                        trace (merged from the RAG Chat platform)
 *   DeepSeek Chat      — V3-series general chat, fast + inexpensive
 *
 * Each model declares its provider; the AI client routes the request
 * to the matching API (Z.ai or DeepSeek) automatically. If a vendor
 * releases a newer model, add it here — the UI auto-picks up every
 * entry in this catalog.
 */

export type ModelTier = "peak" | "fast" | "fastest";
export type ModelProvider = "zai" | "deepseek";

export interface ModelConfig {
  id: string;            // matches what the provider API expects
  label: string;         // display label
  provider: ModelProvider;
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
    provider: "zai",
    tier: "peak",
    contextWindow: 128_000,
    maxOutput: 16_000,
    reasoning: true,
    description: "Peak reasoning. Full token limits. Maximum depth. Your daily driver.",
  },
  {
    id: "glm-5.1",
    label: "GLM 5.1",
    provider: "zai",
    tier: "fast",
    contextWindow: 128_000,
    maxOutput: 12_000,
    reasoning: true,
    description: "Most recent prior release. Still strong reasoning, slightly faster than 5.2.",
  },
  {
    id: "glm-5.1-flash",
    label: "GLM 5.1 Flash",
    provider: "zai",
    tier: "fastest",
    contextWindow: 128_000,
    maxOutput: 6_000,
    reasoning: false,
    description: "Fastest in the 5.x line. Quick lookups, drafts, trivial edits.",
  },
  {
    id: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    provider: "deepseek",
    tier: "peak",
    contextWindow: 64_000,
    maxOutput: 8_000,
    reasoning: true,
    description: "R1-series reasoning with a visible thinking trace. Strong on documents + math.",
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    provider: "deepseek",
    tier: "fast",
    contextWindow: 64_000,
    maxOutput: 8_000,
    reasoning: false,
    description: "V3-series general chat. Fast, inexpensive, capable.",
  },
];

const DEFAULT_MODEL = "glm-5.2";

export function getModel(id: string): ModelConfig | undefined {
  return MODELS.find((m) => m.id === id);
}

/**
 * Resolve the provider for a model id. Unknown ids default to Z.ai —
 * preserving the pre-merge behavior where every request hit the
 * Z.ai endpoint.
 */
export function getProviderForModel(id: string): ModelProvider {
  return getModel(id)?.provider ?? "zai";
}

export function getDefaultModel(): ModelConfig {
  return getModel(DEFAULT_MODEL)!;
}
