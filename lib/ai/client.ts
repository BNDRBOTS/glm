/**
 * GLM Power Platform — AI Client Wrapper
 * ---------------------------------------------------------------------
 * Single entry point to talk to GLM models. SERVER-ONLY.
 *
 * Drop-in pattern for the user:
 *   1. Get a Z.ai API key at https://z.ai (or open.bigmodel.cn)
 *   2. Put it in .env as ZAI_API_KEY=...
 *   3. Done. This client picks it up automatically.
 *
 * Future hooks (already structured, no implementation needed now):
 *   - Behavioral wrappers can transform `messages` before send
 *   - Memory mesh can prepend semantic context to `messages`
 *   - Tool/integration calls can be appended to `tools`
 *
 * Calls the Z.ai API directly (OpenAI-compatible) — no SDK config file
 * dance, works with just an env var.
 *
 * Falls back to a deterministic mock stream when no API key is set,
 * so the UI is fully usable during local preview / setup.
 */

import "@/lib/server-guard";
import { getModel } from "./models";

export interface ChatTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }) => void;
  onDone?: (full: string) => void;
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
  // GLM 5.2 reasoning toggle — on by default for peak tier
  thinking?: boolean;
  /**
   * Abort signal — when the caller (e.g. a disconnecting client)
   * aborts, the upstream request is cancelled too instead of burning
   * tokens on a response nobody will receive.
   */
  signal?: AbortSignal;
}

const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";

export class GLMClient {
  private apiKey: string | null;
  private hasKey: boolean;

  constructor() {
    const key = process.env.ZAI_API_KEY;
    this.hasKey = Boolean(key && key.length > 0);
    this.apiKey = this.hasKey ? key! : null;
  }

  get isConfigured() {
    return this.hasKey;
  }

  /**
   * Streaming chat. Yields tokens via callbacks.
   * Returns the full text once done.
   */
  async stream(req: ChatRequest, cbs: StreamCallbacks): Promise<string> {
    const model = getModel(req.model);
    const finalMessages = this.applyWrappers(req);

    if (!this.isConfigured) {
      // In production, mock streaming is forbidden — it silently feeds
      // the user fake text that looks like a real LLM response, which
      // is the worst possible failure mode for a paid product. Fail
      // loudly so the operator notices immediately.
      if (process.env.NODE_ENV === "production") {
        const err = new Error(
          "ZAI_API_KEY is not configured. Live chat is unavailable — set ZAI_API_KEY in the environment."
        );
        cbs.onError?.(err);
        throw err;
      }
      return this.mockStream(req, cbs);
    }

    try {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: finalMessages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? model?.maxOutput ?? 8_000,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: req.thinking === false ? "disabled" : "enabled" },
      };

      const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Z.ai API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
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
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              cbs.onToken?.(delta);
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

      cbs.onDone?.(full);
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
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content ?? "";
    const reply = [
      "**Preview mode** — no API key detected.\n\n",
      "Once you drop your `ZAI_API_KEY` into `.env`, this exact interface streams live from GLM 5.2 with full token limits, maximum reasoning, and turn-by-turn JSON logging to the database.\n\n",
      "**You said:**\n\n> " + userText.slice(0, 400) + (userText.length > 400 ? "…" : "") + "\n\n",
      "Everything else is already wired:\n",
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
    cbs.onDone?.(full);
    return full;
  }
}

// Singleton — re-used across requests
let _client: GLMClient | null = null;
export function getGLMClient(): GLMClient {
  if (!_client) _client = new GLMClient();
  return _client;
}
