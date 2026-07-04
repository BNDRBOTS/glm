/**
 * Connector tool-calling layer.
 * ---------------------------------------------------------------------
 * Lets the AI invoke connector capabilities (search/fetch/list/push)
 * by emitting a fenced code block with a special language tag:
 *
 *   ```tool:connector:search
 *   { "provider": "github", "query": "next-auth", "limit": 5 }
 *   ```
 *
 * Or:
 *   ```tool:connector:fetch
 *   { "provider": "notion", "id": "abc-123" }
 *   ```
 *
 * The server parses these blocks from the AI output, looks up the
 * user's stored credentials for that provider, decrypts them, and
 * invokes the connector method. The result is returned as a system
 * message the AI can use on the next turn.
 *
 * SECURITY:
 *   - If a skill is active and has allowedConnectors set, only those
 *     connectors may be called. Empty array = no restriction.
 *   - All decryption happens server-side; credentials never leave the
 *     server.
 *   - Tool output is capped to prevent context overflow.
 */

import "@/lib/server-guard";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/auth/crypto";
import { getConnector, type ConnectorContext } from "@/lib/connectors/registry";

export type ToolCallKind = "search" | "fetch" | "list" | "push";

export interface ParsedToolCall {
  provider: string;
  kind: ToolCallKind;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  provider: string;
  kind: ToolCallKind;
  ok: boolean;
  // Truncated result for the AI context window (we cap output so a
  // giant search result doesn't blow the context budget).
  summary: string;
  // Full result for audit logging (not sent to AI).
  full: unknown;
  error?: string;
}

const MAX_RESULT_CHARS = 4000;

/**
 * Parse tool-call blocks out of an AI response. Returns the list of
 * calls (in order) AND the cleaned response (with the blocks removed).
 */
export function parseToolCalls(aiOutput: string): {
  calls: ParsedToolCall[];
  cleaned: string;
} {
  const calls: ParsedToolCall[] = [];
  // Match ```tool:connector:KIND ... ```
  const re = /```tool:connector:(search|fetch|list|push)\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(aiOutput)) !== null) {
    const kind = m[1] as ToolCallKind;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(m[2].trim());
    } catch {
      // skip malformed
      continue;
    }
    const provider = String(args.provider ?? "").trim();
    if (!provider) continue;
    calls.push({ provider, kind, args });
  }
  // Remove the blocks from the visible response.
  const cleaned = aiOutput.replace(re, "").trim();
  return { calls, cleaned };
}

/**
 * Execute a parsed tool call. Looks up credentials, decrypts, and
 * invokes the connector method. Returns a result the AI can consume.
 */
export async function executeToolCall(
  userId: string,
  call: ParsedToolCall,
  allowedConnectors: string[] | null
): Promise<ToolCallResult> {
  // Enforce skill-scoped allowlist if set.
  if (allowedConnectors && allowedConnectors.length > 0 && !allowedConnectors.includes(call.provider)) {
    return {
      provider: call.provider,
      kind: call.kind,
      ok: false,
      summary: `Connector "${call.provider}" is not allowed by the active skill.`,
      full: null,
      error: "not_allowed_by_skill",
    };
  }

  const connector = getConnector(call.provider);
  if (!connector) {
    return {
      provider: call.provider,
      kind: call.kind,
      ok: false,
      summary: `Connector "${call.provider}" is not registered.`,
      full: null,
      error: "unknown_provider",
    };
  }

  // Check capability is implemented + declared.
  const cap = connector.manifest.capabilities as Record<string, boolean | undefined>;
  if (!cap[call.kind]) {
    return {
      provider: call.provider,
      kind: call.kind,
      ok: false,
      summary: `Connector "${call.provider}" does not support ${call.kind}.`,
      full: null,
      error: "capability_not_supported",
    };
  }

  // Look up stored credentials.
  const integration = await db.integration.findUnique({
    where: { userId_provider: { userId, provider: call.provider } },
    select: { credentials: true },
  });
  if (!integration) {
    return {
      provider: call.provider,
      kind: call.kind,
      ok: false,
      summary: `No saved credentials for connector "${call.provider}". The user must add a key in the Connectors panel first.`,
      full: null,
      error: "no_credentials",
    };
  }

  let credentials: Record<string, string> = {};
  try {
    credentials = JSON.parse(await decrypt(integration.credentials));
  } catch (e) {
    return {
      provider: call.provider,
      kind: call.kind,
      ok: false,
      summary: `Failed to decrypt stored credentials for "${call.provider}".`,
      full: null,
      error: String(e),
    };
  }

  const ctx: ConnectorContext = { credentials };
  try {
    let result: unknown;
    if (call.kind === "search") {
      const query = String(call.args.query ?? "");
      const limit = typeof call.args.limit === "number" ? call.args.limit : 10;
      if (!query) throw new Error("Missing 'query' arg");
      result = await connector.search!(ctx, query, { limit });
    } else if (call.kind === "fetch") {
      const id = String(call.args.id ?? "");
      if (!id) throw new Error("Missing 'id' arg");
      result = await connector.fetch!(ctx, id);
    } else if (call.kind === "list") {
      result = await connector.list!(ctx);
    } else if (call.kind === "push") {
      const resourceId = String(call.args.resourceId ?? "");
      const content = String(call.args.content ?? "");
      if (!resourceId || !content) throw new Error("Missing 'resourceId' or 'content' arg");
      result = await connector.push!(ctx, resourceId, content);
    } else {
      throw new Error(`Unknown kind: ${call.kind}`);
    }

    const fullStr = JSON.stringify(result);
    const summary = fullStr.length > MAX_RESULT_CHARS
      ? fullStr.slice(0, MAX_RESULT_CHARS) + `\n…[truncated, ${fullStr.length} chars total]`
      : fullStr;

    return {
      provider: call.provider,
      kind: call.kind,
      ok: true,
      summary,
      full: result,
    };
  } catch (e) {
    return {
      provider: call.provider,
      kind: call.kind,
      ok: false,
      summary: `Tool call failed: ${(e as Error).message}`,
      full: null,
      error: (e as Error).message,
    };
  }
}

/**
 * Inject a tool-calling instruction into the system prefix so the AI
 * knows which connectors it can call and the exact fenced-block syntax
 * to emit. Appended to any existing systemPrefix.
 */
export function buildToolCallSystemPrefix(
  allowedConnectors: string[] | null,
  allConnectors: { id: string; label: string; capabilities: Record<string, boolean | undefined> }[]
): string {
  // If a skill restricts connectors, only show those; otherwise show all
  // connectors the user has credentials for (caller can refine).
  const visible = allowedConnectors && allowedConnectors.length > 0
    ? allConnectors.filter((c) => allowedConnectors.includes(c.id))
    : allConnectors;

  if (visible.length === 0) return "";

  const lines: string[] = [
    "You have access to the following connectors. To use one, emit a fenced code block with the syntax below — the system will execute the call and feed the result back to you on the next turn.",
    "",
    "Available connectors + capabilities:",
  ];
  for (const c of visible) {
    const caps = Object.entries(c.capabilities)
      .filter(([_, v]) => v)
      .map(([k]) => k)
      .join(", ");
    lines.push(`- ${c.id} (${c.label}): ${caps}`);
  }
  lines.push("");
  lines.push("Syntax:");
  lines.push("```tool:connector:search");
  lines.push('{ "provider": "github", "query": "next-auth", "limit": 5 }');
  lines.push("```");
  lines.push("");
  lines.push("For fetch:");
  lines.push("```tool:connector:fetch");
  lines.push('{ "provider": "notion", "id": "page-id" }');
  lines.push("```");
  lines.push("");
  lines.push("For list:");
  lines.push("```tool:connector:list");
  lines.push('{ "provider": "github" }');
  lines.push("```");
  lines.push("");
  lines.push("For push:");
  lines.push("```tool:connector:push");
  lines.push('{ "provider": "localfs", "resourceId": "notes.txt", "content": "..." }');
  lines.push("```");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Emit ONE tool call per turn. Wait for the result before the next call.");
  lines.push("- After receiving the result, synthesize it into your response. Do NOT paste the raw JSON back to the user verbatim — explain what you found.");
  lines.push("- If a tool call fails, tell the user what went wrong and suggest a fix.");
  return lines.join("\n");
}
