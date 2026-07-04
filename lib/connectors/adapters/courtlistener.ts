import type { Connector, ConnectorContext } from "../registry";

/**
 * CourtListener connector — Free Law Project.
 * ---------------------------------------------------------------------
 * Free, open legal case law API. Rate-limited but no key required
 * for basic use. Optional API token raises rate limits significantly.
 *
 * Get token: https://www.courtlistener.com/help/api/rest/
 *
 * Capabilities:
 *   - search cases by query (full-text + filters)
 *   - fetch individual opinions / dockets
 *   - list recap documents
 *
 * All endpoints documented at:
 *   https://www.courtlistener.com/help/api/rest/v3/
 */
export const courtlistenerConnector: Connector = {
  manifest: {
    id: "courtlistener",
    label: "CourtListener",
    description: "Free case law search (Free Law Project). Optional token for higher rate limits.",
    category: "LEGAL_RESEARCH",
    authType: "api_key",
    iconKey: "courtlistener",
    envKey: "COURTLISTENER_API_TOKEN",
    authUrl: "https://www.courtlistener.com/help/api/rest/",
    baseUrl: "https://www.courtlistener.com/api/rest/v3",
    capabilities: { search: true, fetch: true, list: true },
  },

  async testConnection(ctx: ConnectorContext) {
    const token = ctx.credentials.token || process.env.COURTLISTENER_API_TOKEN;
    // No token = anonymous tier (still works, just lower rate). Test both.
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Token ${token}`;
    try {
      const r = await fetch(`${this.manifest.baseUrl}/courts/?limit=1`, { headers });
      if (r.ok) {
        return {
          ok: true,
          message: token
            ? "CourtListener connected (authenticated tier)."
            : "CourtListener connected (anonymous tier — set token for higher rate limits).",
        };
      }
      return { ok: false, message: `CourtListener rejected (${r.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${(e as Error).message}` };
    }
  },

  async search(ctx: ConnectorContext, query: string, opts?: { limit?: number }) {
    const token = ctx.credentials.token || process.env.COURTLISTENER_API_TOKEN;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Token ${token}`;

    const url = new URL(`${this.manifest.baseUrl}/search/`);
    url.searchParams.set("q", query);
    url.searchParams.set("type", "o"); // opinions
    url.searchParams.set("order_by", "score desc");
    url.searchParams.set("limit", String(opts?.limit ?? 10));

    const r = await fetch(url.toString(), { headers });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results ?? []).map((o: any) => ({
      id: String(o.id),
      title: o.caseName ?? o.case_name ?? "Untitled case",
      snippet: o.snippet ?? o.excerpt,
      url: o.absolute_url ?? `https://www.courtlistener.com${o.absolute_url}`,
      metadata: {
        court: o.court,
        dateFiled: o.dateFiled,
        judge: o.judge,
        status: o.status,
        citation: o.citation,
      },
      timestamp: o.dateFiled,
    }));
  },

  async fetch(ctx: ConnectorContext, id: string) {
    const token = ctx.credentials.token || process.env.COURTLISTENER_API_TOKEN;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Token ${token}`;

    const r = await fetch(`${this.manifest.baseUrl}/opinions/${id}/`, { headers });
    if (!r.ok) throw new Error(`CourtListener fetch failed: ${r.status}`);
    const o = await r.json();
    return {
      id,
      title: o.caseName ?? o.case_name ?? `Opinion ${id}`,
      content: o.text || o.html || o.plain_text || "",
      url: o.absolute_url ? `https://www.courtlistener.com${o.absolute_url}` : undefined,
      metadata: {
        court: o.court,
        dateFiled: o.dateFiled,
        judge: o.judge,
        status: o.status,
        citations: o.citations,
      },
      fetchedAt: new Date().toISOString(),
    };
  },

  async list(ctx: ConnectorContext) {
    const token = ctx.credentials.token || process.env.COURTLISTENER_API_TOKEN;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Token ${token}`;
    // List recent dockets as a reasonable default browse
    const r = await fetch(`${this.manifest.baseUrl}/dockets/?limit=20`, { headers });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results ?? []).map((d: any) => ({
      id: String(d.id),
      name: d.case_name ?? d.caseName ?? "Untitled",
      type: "docket",
    }));
  },
};
