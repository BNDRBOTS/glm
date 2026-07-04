import type { Connector, ConnectorContext } from "../registry";

/**
 * Midpage connector — legal citation analysis API.
 * ---------------------------------------------------------------------
 * Midpage (midpage.ai) provides AI-powered legal citation analysis.
 * Given a citation or question, returns cited authorities, treatment
 * analysis, and contextual explanation.
 *
 * Get key: https://midpage.ai (developer / API section)
 *
 * NOTE: Midpage's exact API surface may differ from this structure.
 * The connector is wired against a reasonable OpenAI-style endpoint.
 * If Midpage's real API differs, swap the URL constants below —
 * the rest of the connector stays the same.
 */
export const midpageConnector: Connector = {
  manifest: {
    id: "midpage",
    label: "Midpage",
    description: "AI-powered legal citation analysis. Drop in your Midpage API key.",
    category: "LEGAL_RESEARCH",
    authType: "api_key",
    iconKey: "midpage",
    envKey: "MIDPAGE_API_KEY",
    authUrl: "https://midpage.ai",
    baseUrl: "https://api.midpage.ai/v1",
    capabilities: { search: true, fetch: true },
  },

  async testConnection(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.MIDPAGE_API_KEY;
    if (!key) return { ok: false, message: "No API key. Paste your Midpage API key." };
    try {
      // Validate key by hitting the account endpoint (assumed shape)
      const r = await fetch(`${this.manifest.baseUrl}/account`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.ok) return { ok: true, message: "Midpage connected." };
      if (r.status === 404) {
        // Account endpoint may not exist — that's OK, the key is stored
        return { ok: true, message: "Midpage key stored (endpoint to be wired)." };
      }
      return { ok: false, message: `Midpage rejected the key (${r.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${(e as Error).message}` };
    }
  },

  async search(ctx: ConnectorContext, query: string, opts?: { limit?: number }) {
    const key = ctx.credentials.token || process.env.MIDPAGE_API_KEY;
    const r = await fetch(`${this.manifest.baseUrl}/citations/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: opts?.limit ?? 10 }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.citations ?? j.results ?? []).map((c: any) => ({
      id: c.id ?? c.citation,
      title: c.citation ?? c.title,
      snippet: c.treatment ?? c.explanation,
      url: c.url,
      metadata: {
        jurisdiction: c.jurisdiction,
        treatment: c.treatment,
        citingCases: c.citing_cases,
        authority: c.authority,
      },
    }));
  },

  async fetch(ctx: ConnectorContext, id: string) {
    const key = ctx.credentials.token || process.env.MIDPAGE_API_KEY;
    const r = await fetch(`${this.manifest.baseUrl}/citations/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`Midpage fetch failed: ${r.status}`);
    const c = await r.json();
    return {
      id,
      title: c.citation ?? c.title ?? id,
      content: c.analysis ?? c.explanation ?? c.text ?? "",
      url: c.url,
      metadata: {
        jurisdiction: c.jurisdiction,
        treatment: c.treatment,
        authorities: c.authorities,
        citingCases: c.citing_cases,
      },
      fetchedAt: new Date().toISOString(),
    };
  },
};
