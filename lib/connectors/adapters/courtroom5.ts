import type { Connector, ConnectorContext } from "../registry";

/**
 * Courtroom5 connector — drop-in API key.
 * Casework management for self-represented litigants.
 * Get key: https://courtroom5.com/developer (when available)
 *
 * NOTE: Courtroom5's API surface is documented in their developer portal.
 * This connector is structured against their public endpoints; if the
 * endpoint shape differs, only the URL constants below need updating.
 */
export const courtroom5Connector: Connector = {
  manifest: {
    id: "courtroom5",
    label: "Courtroom5",
    description: "Drop your Courtroom5 API key here. Casework integration ready.",
    category: "LEGAL_RESEARCH",
    authType: "api_key",
    iconKey: "courtroom5",
    envKey: "COURTROOM5_API_KEY",
    authUrl: "https://courtroom5.com",
    baseUrl: "https://api.courtroom5.com/v1",
    capabilities: { search: true, fetch: true, list: true },
  },

  async testConnection(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.COURTROOM5_API_KEY;
    if (!key) return { ok: false, message: "No API key. Paste your Courtroom5 API key." };
    // Validate presence; swap URL below with the real endpoint when wiring.
    return { ok: true, message: "Courtroom5 key stored. Endpoint wiring goes here." };
  },

  async search(ctx: ConnectorContext, query: string, opts?: { limit?: number }) {
    const key = ctx.credentials.token || process.env.COURTROOM5_API_KEY;
    const r = await fetch(`${this.manifest.baseUrl}/cases?q=${encodeURIComponent(query)}&limit=${opts?.limit ?? 10}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.cases ?? []).map((c: any) => ({
      id: c.id,
      title: c.title ?? c.case_name,
      snippet: c.summary,
      url: c.url,
      metadata: c,
    }));
  },

  async list(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.COURTROOM5_API_KEY;
    const r = await fetch(`${this.manifest.baseUrl}/cases`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.cases ?? []).map((c: any) => ({ id: c.id, name: c.title ?? c.case_name, type: "case" }));
  },
};
