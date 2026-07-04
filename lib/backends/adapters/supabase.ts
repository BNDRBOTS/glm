import type { Backend, BackendContext, BackendQueryResult } from "../registry";

/**
 * Supabase backend.
 * Connection string + anon key. Free tier: 500MB DB, 50K MAU, 1GB storage.
 * Docs: https://supabase.com/dashboard/project/_/settings/api
 */
export const supabaseBackend: Backend = {
  manifest: {
    id: "supabase",
    label: "Supabase",
    description: "Postgres + Auth + Storage. Best free tier for full-stack apps.",
    iconKey: "supabase",
    requiredFields: [
      { key: "url", label: "Project URL", type: "url", placeholder: "https://xxxx.supabase.co", required: true },
      { key: "anonKey", label: "Anon Key", type: "password", placeholder: "eyJhbGciOi...", required: true },
    ],
    optionalFields: [
      { key: "serviceRoleKey", label: "Service Role Key (bypasses RLS)", type: "password", placeholder: "eyJhbGciOi...", required: false },
    ],
    strengths: ["Postgres", "Realtime", "Auth", "Storage", "Row Level Security"],
    docsUrl: "https://supabase.com/dashboard/project/_/settings/api",
  },

  async testConnection(ctx: BackendContext) {
    const url = ctx.credentials.url;
    const key = ctx.credentials.anonKey;
    if (!url || !key) return { ok: false, message: "Project URL and anon key are required." };
    try {
      const r = await fetch(`${url}/rest/v1/`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });
      if (r.ok) return { ok: true, message: "Supabase connected." };
      return { ok: false, message: `Supabase rejected (${r.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${(e as Error).message}` };
    }
  },

  async query(ctx: BackendContext, q: string): Promise<BackendQueryResult> {
    const url = ctx.credentials.url;
    const key = ctx.credentials.anonKey;
    const start = Date.now();
    // Supabase REST API — q is treated as a PostgREST filter path
    // e.g. "chats?select=*&limit=10"
    const r = await fetch(`${url}/rest/v1/${q}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const rows = await r.json();
    return {
      rows: Array.isArray(rows) ? rows : [rows],
      count: Array.isArray(rows) ? rows.length : 1,
      durationMs: Date.now() - start,
    };
  },

  async push(ctx: BackendContext, table: string, record: Record<string, unknown>) {
    const url = ctx.credentials.url;
    const key = ctx.credentials.anonKey;
    const r = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(record),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json();
    return { ok: true, id: j?.[0]?.id };
  },
};
