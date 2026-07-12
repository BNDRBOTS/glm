/**
 * AI Client Wrapper — multi-provider (Z.ai GLM + DeepSeek). SERVER-ONLY.
 * ---------------------------------------------------------------------
 * Single entry point for streaming chat. The model catalog declares
 * which provider each model belongs to; this client routes the call:
 *
 *   zai      — https://api.z.ai/api/paas/v4  (ZAI_API_KEY)
 *   deepseek — https://api.deepseek.com/v1   (DEEPSEEK_API_KEY)
 *
 * Both APIs are OpenAI-compatible SSE streams. Reasoning tokens
 * (delta.reasoning_content — emitted by deepseek-reasoner AND by
 * thinking-enabled GLM models) surface through onThinkingToken and
 * are kept strictly separate from content.
 *
 * DeepSeek's reasoner requires strictly alternating user/assistant
 * turns after the system message. buildProviderMessages() (ported
 * from ragdb's stream route) merges consecutive same-role turns and
 * folds stray system/tool turns so the API never 400s.
 *
 * Future hooks (already structured):
 *   - Behavioral wrappers transform `messages` before send
 *   - Memory mesh can prepend semantic context to `messages`
 *   - Tool/integration calls can be appended to `tools`
 *
 * Falls back to a deterministic mock stream when the provider's key
 * is not set in dev/preview, so the UI is fully usable during setup.
 * In production a missing key fails loudly — mock text that looks
 * like a real LLM response is the worst failure mode for a paid
 * product.
 */

import "@/lib/server-guard";
import { getModel, getProviderForModel, type ModelProvider } from "./models";

export interface ChatTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  /** Reasoning-trace tokens (deepseek-reasoner / GLM thinking). */
  onThinkingToken?: (token: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }) => void;
  onDone?: (full: string, fullThinking?: string) => void;
  onError?: (err: Error) => void;
}

export interface ChatRequest {
  model: string;
  messages: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
  // Hooks for future wrappers (ignored if undefined)
  tools?: unknown;
  systemPrefix?: string;
  systemSuffix?: string;
  // Reasoning toggle — on by default for reasoning-capable models
  thinking?: boolean;
}

const PROVIDER_CONFIG: Record<
  ModelProvider,
  { baseUrl: string; envKey: string; label: string }
> = {
  zai: {
    baseUrl: "https://api.z.ai/api/paas/v4",
    envKey: "ZAI_API_KEY",
    label: "Z.ai",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
  },
};

export function isProviderConfigured(provider: ModelProvider): boolean {
  const key = process.env[PROVIDER_CONFIG[provider].envKey];
  return Boolean(key && key.length > 0);
}

/**
 * Normalize a message list for a provider. Ported from ragdb's
 * buildMessages: leading system turns are merged into one system
 * message; for DeepSeek the remaining turns are forced into strict
 * user/assistant alternation (consecutive same-role turns merged,
 * non-leading system/tool turns folded into user turns, leading
 * assistant turns dropped). Z.ai accepts the list as-is.
 */
export function buildProviderMessages(
  provider: ModelProvider,
  messages: ChatTurn[]
): ChatTurn[] {
  // Collect leading system content into a single system turn.
  const systemParts: string[] = [];
  let i = 0;
  while (i < messages.length && messages[i].role === "system") {
    systemParts.push(messages[i].content);
    i++;
  }
  const rest = messages.slice(i);
  const system: ChatTurn[] = systemParts.length
    ? [{ role: "system", content: systemParts.join("\n\n") }]
    : [];

  if (provider !== "deepseek") {
    return [...system, ...rest];
  }

  // DeepSeek: strict alternation. Fold system/tool turns into user
  // turns, merge consecutive same-role turns, drop a leading
  // assistant turn (the API requires the first non-system to be user).
  const merged: ChatTurn[] = [];
  for (const turn of rest) {
    const role: "user" | "assistant" =
      turn.role === "assistant" ? "assistant" : "user";
    const content =
      turn.role === "system" || turn.role === "tool"
        ? `[${turn.role}]\n${turn.content}`
        : turn.content;
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.content += "\n\n" + content;
    } else {
      merged.push({ role, content });
    }
  }
  while (merged.length > 0 && merged[0].role !== "user") merged.shift();

  return [...system, ...merged];
}

export class GLMClient {
  get isConfigured() {
    // Back-compat: "configured" historically meant the Z.ai key.
    return isProviderConfigured("zai");
  }

  /**
   * Streaming chat. Yields tokens via callbacks.
   * Returns the full content text once done.
   */
  async stream(req: ChatRequest, cbs: StreamCallbacks): Promise<string> {
    const model = getModel(req.model);
    const provider = getProviderForModel(req.model);
    const config = PROVIDER_CONFIG[provider];
    const finalMessages = buildProviderMessages(provider, this.applyWrappers(req));

    if (!isProviderConfigured(provider)) {
      if (process.env.NODE_ENV === "production") {
        const err = new Error(
          `${config.envKey} is not configured. Live chat on ${config.label} is unavailable — set ${config.envKey} in the environment.`
        );
        cbs.onError?.(err);
        throw err;
      }
      return this.mockStream(req, cbs);
    }

    const apiKey = process.env[config.envKey]!;

    try {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: finalMessages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? model?.maxOutput ?? 8_000,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (provider === "zai") {
        // Z.ai-specific reasoning toggle. DeepSeek's reasoner always
        // thinks; its chat model never does — no parameter exists.
        body.thinking = { type: req.thinking === false ? "disabled" : "enabled" };
      }

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${config.label} API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      let fullThinking = "";
      let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta ?? {};
            const reasoning = delta.reasoning_content ?? "";
            if (reasoning) {
              fullThinking += reasoning;
              cbs.onThinkingToken?.(reasoning);
            }
            const content = delta.content ?? "";
            if (content) {
              full += content;
              cbs.onToken?.(content);
            }
            if (chunk.usage) {
              usage = chunk.usage;
            }
          } catch {
            // skip malformed chunk
          }
        }
      }

      if (usage) {
        cbs.onUsage?.({
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        });
      }

      cbs.onDone?.(full, fullThinking);
      return full;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      cbs.onError?.(e);
      throw e;
    }
  }

  /**
   * Apply future behavioral wrappers here.
   * Memory mesh / system overrides / tool injection all go through this.
   * Today it just prepends/appends system content if provided.
   */
  private applyWrappers(req: ChatRequest): ChatTurn[] {
    const out: ChatTurn[] = [];
    const sysParts: string[] = [];
    if (req.systemPrefix) sysParts.push(req.systemPrefix);
    if (req.systemSuffix) sysParts.push(req.systemSuffix);

    if (sysParts.length) {
      out.push({
        role: "system",
        content: sysParts.join("\n\n"),
      });
    }
    out.push(...req.messages);
    return out;
  }

  /**
   * Mock stream for preview-without-key. Streams a deterministic reply.
   */
  private async mockStream(req: ChatRequest, cbs: StreamCallbacks): Promise<string> {
    const provider = getProviderForModel(req.model);
    const envKey = PROVIDER_CONFIG[provider].envKey;
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content ?? "";
    const reply = [
      "**Preview mode** — no API key detected for this model.\n\n",
      "Once you drop your `" + envKey + "` into `.env`, this exact interface streams live with full token limits, reasoning traces, and turn-by-turn JSON logging to the database.\n\n",
      "**You said:**\n\n> " + userText.slice(0, 400) + (userText.length > 400 ? "…" : "") + "\n\n",
      "Everything else is already wired:\n",
      "- RAG document intelligence (upload PDFs/DOCX/XLSX — cited answers)\n",
      "- Code canvas (HTML + React preview, back button)\n",
      "- Integrations panel (Notion, GitHub, Courtroom5, Local FS — drop-in API key)\n",
      "- Memory & exports (deep aggregate + raw chat export)\n",
      "- Dark mode #000 glassmorphism + Apple-clean light mode\n",
      "- Two separate accounts + groups (slot ready)\n",
      "- Stripe billing (slot ready)\n",
      "- Pinecone memory mesh (slot ready)\n",
    ].join("");

    let full = "";
    const tokens = reply.split(/(\s+)/);
    for (const t of tokens) {
      await new Promise((r) => setTimeout(r, 18));
      full += t;
      cbs.onToken?.(t);
    }
    cbs.onUsage?.({
      promptTokens: Math.ceil(userText.length / 4),
      completionTokens: Math.ceil(reply.length / 4),
      totalTokens: Math.ceil((userText.length + reply.length) / 4),
    });
    cbs.onDone?.(full, "");
    return full;
  }
}

// Singleton — re-used across requests
let _client: GLMClient | null = null;
export function getGLMClient(): GLMClient {
  if (!_client) _client = new GLMClient();
  return _client;
}

/** Provider-neutral alias — same singleton. */
export const getAIClient = getGLMClient;
