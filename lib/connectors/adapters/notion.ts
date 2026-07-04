import type { Connector, ConnectorContext, ConnectorSearchResult, ConnectorFetchResult } from "../registry";

/**
 * Notion connector — drop-in API key.
 * Get key: https://www.notion.so/profile/integrations
 */
export const notionConnector: Connector = {
  manifest: {
    id: "notion",
    label: "Notion",
    description: "Connect Notion workspaces. Pull page content, push summaries back.",
    category: "PRODUCTIVITY",
    authType: "api_key",
    iconKey: "notion",
    envKey: "NOTION_API_KEY",
    authUrl: "https://www.notion.so/profile/integrations",
    baseUrl: "https://api.notion.com/v1",
    // NOTE: `push` is intentionally false — the Notion append-blocks call
    // is wired in lib/connectors/adapters/notion.ts below, but only for
    // simple page-level appends. Enable when full push semantics are needed.
    capabilities: { search: true, fetch: true, list: true },
  },

  async testConnection(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.NOTION_API_KEY;
    if (!key) return { ok: false, message: "No API key. Paste your Notion internal integration token." };
    try {
      const r = await fetch(`${this.manifest.baseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28" },
      });
      if (r.ok) return { ok: true, message: "Notion connected." };
      return { ok: false, message: `Notion rejected the key (${r.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${(e as Error).message}` };
    }
  },

  async search(ctx: ConnectorContext, query: string, opts?: { limit?: number }): Promise<ConnectorSearchResult[]> {
    const key = ctx.credentials.token || process.env.NOTION_API_KEY;
    if (!key) throw new Error("Notion API key not configured");
    const r = await fetch(`${this.manifest.baseUrl}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: JSON.stringify({ query, page_size: opts?.limit ?? 10 }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Notion search failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    return (j.results ?? []).map((p: any) => ({
      id: p.id,
      title: p.properties?.title?.title?.[0]?.plain_text ?? "Untitled",
      url: p.url,
      metadata: { object: p.object, lastEdited: p.last_edited_time },
    }));
  },

  async list(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.NOTION_API_KEY;
    if (!key) throw new Error("Notion API key not configured");
    const r = await fetch(`${this.manifest.baseUrl}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 20 }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Notion list failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    return (j.results ?? []).map((p: any) => ({
      id: p.id,
      name: p.properties?.title?.title?.[0]?.plain_text ?? "Untitled",
      type: p.object,
    }));
  },

  async fetch(ctx: ConnectorContext, id: string): Promise<ConnectorFetchResult> {
    const key = ctx.credentials.token || process.env.NOTION_API_KEY;
    if (!key) throw new Error("Notion API key not configured");
    const r = await fetch(`${this.manifest.baseUrl}/blocks/${id}/children`, {
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28" },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Notion fetch failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    const content = (j.results ?? [])
      .map((b: any) => b[b.type]?.rich_text?.map((r: any) => r.plain_text).join("") ?? "")
      .filter(Boolean)
      .join("\n");
    return {
      id,
      title: id,
      content,
      url: `https://notion.so/${id.replace(/-/g, "")}`,
      fetchedAt: new Date().toISOString(),
    };
  },
};
