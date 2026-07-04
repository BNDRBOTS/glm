/**
 * GLM Power Platform — Real-time Distillation Layer
 * ---------------------------------------------------------------------
 * Processes the chat stream turn-by-turn. Extracts:
 *   - Stated intent (frozen from first user message — never abstracted)
 *   - Entities (named things, deduped)
 *   - Facts (definitional statements)
 *   - Decisions (committed choices)
 *   - Open questions (unresolved)
 *   - Action items (next steps)
 *
 * CRITICAL DESIGN PRINCIPLE:
 *   Distillation never abstracts away the target intent. The intent
 *   is captured ONCE from the first user message and used as a
 *   ground-truth anchor. Every subsequent distillation is tagged
 *   with whether it serves the intent or drifts from it.
 *
 *   If the conversation drifts, we surface that as an "intent drift"
 *   signal — we do NOT silently re-summarize the drift away.
 *
 * This module is the real-time layer (fast, deterministic). The
 * deep aggregate export in lib/memory is the slow layer (comprehensive).
 */

export interface DistilledTurn {
  turnId: string;
  role: "user" | "assistant";
  intentAlignment: number;      // 0-1, how aligned with original intent
  newEntities: string[];
  newFacts: string[];
  newDecisions: string[];
  newActionItems: string[];
  newOpenQuestions: string[];
  timestamp: string;
}

export interface DistillationState {
  chatId: string;
  originalIntent: string;       // FROZEN from first user message
  intentFrozenAt: string;
  entities: string[];
  facts: string[];
  decisions: string[];
  actionItems: string[];
  openQuestions: string[];
  turns: DistilledTurn[];
  /** Rolling alignment score across the whole chat */
  overallAlignment: number;
  /** True if any recent turn dropped below 0.3 alignment */
  driftDetected: boolean;
  lastUpdated: string;
}

// ---------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------

export function freezeIntent(firstUserMessage: string): { intent: string; frozenAt: string } {
  // The intent is the first user message, lightly cleaned.
  // We do NOT summarize it — that would be abstraction. We keep it raw.
  const intent = firstUserMessage.trim().slice(0, 1000);
  return { intent, frozenAt: new Date().toISOString() };
}

export function distillTurn(
  state: DistillationState,
  turn: { id: string; role: "user" | "assistant"; content: string }
): DistillationState {
  const newEntities = extractEntities(turn.content, state.entities);
  const newFacts = extractFacts(turn.content, state.facts);
  const newDecisions = extractDecisions(turn.content, state.decisions);
  const newActionItems = extractActionItems(turn.content, state.actionItems);
  const newOpenQuestions = extractOpenQuestions(turn.content, state.openQuestions);
  const intentAlignment = scoreAlignment(turn.content, state.originalIntent);

  const distilled: DistilledTurn = {
    turnId: turn.id,
    role: turn.role,
    intentAlignment,
    newEntities,
    newFacts,
    newDecisions,
    newActionItems,
    newOpenQuestions,
    timestamp: new Date().toISOString(),
  };

  // Compute rolling alignment (weighted: recent turns matter more)
  const allAlignments = [...state.turns.map((t) => t.intentAlignment), intentAlignment];
  const weighted = allAlignments
    .slice(-10)
    .map((a, i, arr) => a * ((i + 1) / arr.length));
  const overallAlignment = weighted.length
    ? weighted.reduce((s, x) => s + x, 0) / weighted.length
    : 1;

  // Drift = any of last 3 turns below 0.3
  const recent = allAlignments.slice(-3);
  const driftDetected = recent.length >= 2 && recent.some((a) => a < 0.3);

  return {
    ...state,
    entities: [...state.entities, ...newEntities],
    facts: [...state.facts, ...newFacts],
    decisions: [...state.decisions, ...newDecisions],
    actionItems: [...state.actionItems, ...newActionItems],
    openQuestions: [...state.openQuestions, ...newOpenQuestions],
    turns: [...state.turns, distilled],
    overallAlignment,
    driftDetected,
    lastUpdated: new Date().toISOString(),
  };
}

export function initState(chatId: string, firstUserMessage: string): DistillationState {
  const { intent, frozenAt } = freezeIntent(firstUserMessage);
  const state: DistillationState = {
    chatId,
    originalIntent: intent,
    intentFrozenAt: frozenAt,
    entities: [],
    facts: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    turns: [],
    overallAlignment: 1,
    driftDetected: false,
    lastUpdated: new Date().toISOString(),
  };
  // Distill the first user turn to bootstrap entities/facts
  return distillTurn(state, { id: "first", role: "user", content: firstUserMessage });
}

// ---------------------------------------------------------------------
// Extractors (deterministic — fast, no extra AI calls)
// ---------------------------------------------------------------------

function extractEntities(content: string, existing: string[]): string[] {
  const found: string[] = [];
  const re = /\b([A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]+){0,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const e = m[1].trim();
    if (STOPWORD_ENTITIES.has(e)) continue;
    if (existing.includes(e) || found.includes(e)) continue;
    found.push(e);
  }
  return found;
}

function extractFacts(content: string, existing: string[]): string[] {
  const found: string[] = [];
  const sentences = content.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (s.length < 20 || s.length > 280) continue;
    if (!FACT_KEYWORDS.some((k) => lower.includes(k))) continue;
    const trimmed = s.trim();
    if (existing.includes(trimmed) || found.includes(trimmed)) continue;
    found.push(trimmed);
  }
  return found;
}

function extractDecisions(content: string, existing: string[]): string[] {
  const re = /\b(?:decided|chose|agreed|concluded|final answer:|verdict:|going with|picking|selected)\b[^.!?]*[.!?]/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const trimmed = m[0].trim();
    if (existing.includes(trimmed) || found.includes(trimmed)) continue;
    found.push(trimmed);
  }
  return found;
}

function extractActionItems(content: string, existing: string[]): string[] {
  const re = /\b(?:should|must|need to|todo|action:|next step:|will|going to)\b[^.!?]*[.!?]/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const trimmed = m[0].trim();
    if (existing.includes(trimmed) || found.includes(trimmed)) continue;
    found.push(trimmed);
  }
  return found;
}

function extractOpenQuestions(content: string, existing: string[]): string[] {
  const re = /\b(?:what|why|how|when|where|who|which)\b[^.!?]*\?/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const trimmed = m[0].trim();
    if (existing.includes(trimmed) || found.includes(trimmed)) continue;
    found.push(trimmed);
  }
  return found;
}

function scoreAlignment(content: string, intent: string): number {
  if (!intent.trim()) return 1;
  const intentTokens = tokenize(intent);
  if (intentTokens.length === 0) return 1;
  const contentTokens = new Set(tokenize(content));
  const overlap = intentTokens.filter((t) => contentTokens.has(t)).length;
  return Math.min(1, overlap / intentTokens.length);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  "the", "this", "that", "these", "those", "with", "from", "have", "has",
  "will", "would", "could", "should", "about", "into", "your", "their",
  "what", "when", "where", "which", "they", "them", "then", "than",
]);

const STOPWORD_ENTITIES = new Set([
  "The", "This", "That", "These", "Those", "It", "We", "You", "I",
  "He", "She", "They", "Them", "Us", "Me", "Him", "Her",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

const FACT_KEYWORDS = [
  " is ", " are ", " was ", " were ", " means ", " defined as ",
  " equals ", " refers to ", " represents ", " consists of ",
  " requires ", " depends on ", " results in ",
];
