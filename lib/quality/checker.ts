/**
 * GLM Power Platform — Silent AI Quality Checker
 * ---------------------------------------------------------------------
 * Intercepts AI output before delivery. If the output fails the
 * slop check (placeholders, partial impls, diversions), it silently
 * retries the AI with feedback, up to a budget. The user only sees
 * clean output (or a clear warning if the budget runs out).
 *
 * Pipeline:
 *   AI stream → collect → slop check
 *     ├ pass  → deliver to user
 *     ├ fail  → retry with feedback (budget: 3)
 *     │         ├ pass  → deliver
 *     │         └ fail  → deliver with warning + log to QualityLog
 *
 * This is the "full-build-only" enforcement that's always-on when
 * that preset is active, regardless of mode.
 */

import "@/lib/server-guard";
import { detectSlopPatterns } from "../permissions/modes";

export interface QualityCheckResult {
  passed: boolean;
  output: string;
  attempts: number;
  slopDetected: string[];
  feedback?: string;
  /** If true, output was delivered despite failing (budget exhausted) */
  deliveredWithWarning: boolean;
}

export interface QualityCheckerOptions {
  fullBuildOnly: boolean;
  maxRetries: number;
  /** The original spec/user request — used to detect diversions */
  originalIntent: string;
  /** Callback to re-invoke the AI with feedback */
  retry: (messages: { role: "user" | "assistant" | "system"; content: string }[], feedback: string) => Promise<string>;
}

/**
 * Run the silent checker on a completed AI output.
 * Returns the final output to deliver.
 */
export async function checkAndRetry(
  initialOutput: string,
  conversation: { role: "user" | "assistant" | "system"; content: string }[],
  opts: QualityCheckerOptions
): Promise<QualityCheckResult> {
  let currentOutput = initialOutput;
  let attempts = 0;
  const maxAttempts = opts.fullBuildOnly ? opts.maxRetries + 1 : 1;

  while (attempts < maxAttempts) {
    attempts++;
    const slop = opts.fullBuildOnly ? detectSlopPatterns(currentOutput) : [];

    if (slop.length === 0) {
      // Also check intent alignment
      const intentScore = scoreIntentAlignment(currentOutput, opts.originalIntent);
      if (intentScore >= 0.5 || attempts === maxAttempts) {
        return {
          passed: true,
          output: currentOutput,
          attempts,
          slopDetected: [],
          deliveredWithWarning: false,
        };
      }
      // Intent drift — try once more with intent feedback
      if (attempts < maxAttempts) {
        const feedback = buildIntentFeedback(currentOutput, opts.originalIntent, intentScore);
        currentOutput = await opts.retry(conversation, feedback);
        continue;
      }
    }

    if (slop.length > 0 && attempts < maxAttempts) {
      const feedback = buildSlopFeedback(slop, currentOutput);
      currentOutput = await opts.retry(conversation, feedback);
      continue;
    }

    // Budget exhausted
    return {
      passed: false,
      output: currentOutput,
      attempts,
      slopDetected: slop,
      deliveredWithWarning: slop.length > 0,
    };
  }

  return {
    passed: false,
    output: currentOutput,
    attempts,
    slopDetected: detectSlopPatterns(currentOutput),
    deliveredWithWarning: true,
  };
}

/**
 * Build feedback for the AI when slop is detected.
 * Specific, not generic. Tells the AI exactly what to fix.
 */
function buildSlopFeedback(slop: string[], _priorOutput: string): string {
  const lines: string[] = [
    "Your previous response was rejected by the quality checker.",
    "Detected issues:",
  ];
  for (const s of slop) {
    switch (s) {
      case "todo-marker":
        lines.push("- Contains TODO/FIXME markers. Replace every TODO with the actual implementation.");
        break;
      case "placeholder-tag":
        lines.push("- Contains <placeholder> tags. Replace with real values.");
        break;
      case "implement-later":
        lines.push('- Contains "implement later" language. Implement it now.');
        break;
      case "fake-credentials":
        lines.push("- Contains fake credential placeholders. Use environment variables instead (e.g., process.env.API_KEY).");
        break;
      case "empty-function-body":
        lines.push("- Contains empty function bodies. Every function must have a complete implementation.");
        break;
      case "not-implemented-throw":
        lines.push('- Contains "throw new Error(\'not implemented\')". Replace with the actual implementation.');
        break;
      case "python-pass-stub":
        lines.push('- Contains Python "pass" stubs. Replace with real logic.');
        break;
      case "continue-here":
      case "rest-of-code":
        lines.push("- Contains truncation language. Provide the complete code, not a continuation pointer.");
        break;
      case "ellipsis-truncation":
        lines.push("- Ends with ellipsis indicating truncation. Provide the complete implementation.");
        break;
      case "meta-heavy-no-substance":
        lines.push("- Is mostly meta-commentary about what you would do, not the actual doing. Reduce explanation, increase substance.");
        break;
      default:
        if (s.startsWith("fake-import:")) {
          lines.push(`- Imports from "${s.slice("fake-import:".length)}" which is not a real package. Use real, installable packages only.`);
        } else {
          lines.push(`- ${s}`);
        }
    }
  }
  lines.push("", "Regenerate the complete response. No placeholders, no truncation, no diversions. Full implementation only.");
  return lines.join("\n");
}

/**
 * Score how aligned the output is with the original intent.
 * 0 = completely off-topic, 1 = perfectly aligned.
 *
 * Heuristic: token overlap between intent and output, weighted
 * toward the verbs and nouns in the intent.
 */
function scoreIntentAlignment(output: string, intent: string): number {
  if (!intent.trim()) return 1; // no intent = no constraint
  const intentTokens = tokenize(intent);
  const outputTokens = new Set(tokenize(output));
  if (intentTokens.length === 0) return 1;
  const overlap = intentTokens.filter((t) => outputTokens.has(t)).length;
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

function buildIntentFeedback(output: string, intent: string, score: number): string {
  return [
    `Your previous response drifted from the user's original request (intent alignment score: ${(score * 100).toFixed(0)}%).`,
    "",
    "Original request:",
    `"${intent}"`,
    "",
    "Regenerate the response focused on addressing the original request directly. Cut any tangential content.",
  ].join("\n");
}
