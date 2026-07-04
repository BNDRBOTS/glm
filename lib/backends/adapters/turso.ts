import type { Backend, BackendContext, BackendQueryResult } from "../registry";
import "@/lib/server-guard";

/**
 * Turso backend — libSQL at the edge. REAL implementation.
 * ---------------------------------------------------------------------
 * Connection string format:
 *   libsql://your-db.turso.io
 * Plus an auth token.
 *
 * Free tier: 9GB total, 500 databases, 1B row reads/month.
 * Docs: https://docs.turso.tech/connect
 *
 * `@libsql/client` is lazy-loaded inside function bodies.
 */

let _libsql: typeof import("@libsql/client") | null = null;
async function loadLibsql() {
  if (!_libsql) _libsql = await import("@libsql/client");
  return _libsql;
}

export const tursoBackend: Backend = {
  manifest: {
    id: "turso",
    label: "Turso",
    description: "libSQL at the edge. Free tier: 9GB, 500 dbs, 1B reads/month.",
    iconKey: "turso",
    requiredFields: [
      { key: "url", label: "Database URL", type: "url", placeholder: "libsql://your-db.turso.io", required: true },
      { key: "authToken", label: "Auth Token", type: "password", placeholder: "eyJhbGciOi...", required: true },
    ],
    strengths: ["Edge replicas", "SQLite-compatible", "Multi-tenant", "Low latency globally"],
    docsUrl: "https://docs.turso.tech/connect",
  },

  async testConnection(ctx: BackendContext) {
    const url = ctx.credentials.url;
    const token = ctx.credentials.authToken;
    if (!url || !token) return { ok: false, message: "Database URL and auth token required." };
    if (!url.startsWith("libsql://") && !url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false, message: "URL must start with libsql://, http://, or https://" };
    }
    try {
      const { createClient } = await loadLibsql();
      const client = createClient({ url, authToken: token });
      try {
        const r = await client.execute("SELECT 1 AS ok");
        if (r.rows.length === 1) {
          return { ok: true, message: "Turso connected." };
        }
        return { ok: false, message: "Unexpected response from Turso." };
      } finally {
        client.close();
      }
    } catch (e) {
      return { ok: false, message: `Turso error: ${(e as Error).message}` };
    }
  },

  async query(ctx: BackendContext, q: string, params?: unknown[]): Promise<BackendQueryResult> {
    const url = ctx.credentials.url;
    const token = ctx.credentials.authToken;
    if (!url || !token) return { rows: [], count: 0, durationMs: 0 };
    const { createClient } = await loadLibsql();
    const client = createClient({ url, authToken: token });
    const start = Date.now();
    try {
      const r = await client.execute({
        sql: q,
        args: (params as any[]) ?? [],
      });
      return {
        rows: r.rows as Record<string, unknown>[],
        count: r.rows.length,
        durationMs: Date.now() - start,
      };
    } finally {
      client.close();
    }
  },

  async push(ctx: BackendContext, table: string, record: Record<string, unknown>) {
    const url = ctx.credentials.url;
    const token = ctx.credentials.authToken;
    if (!url || !token) return { ok: false };
    const { createClient } = await loadLibsql();
    const client = createClient({ url, authToken: token });
    try {
      const cols = Object.keys(record);
      const vals = Object.values(record);
      const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
      const r = await client.execute({
        sql: `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders}) RETURNING id`,
        args: vals as any[],
      });
      const id = (r.rows[0] as any)?.id;
      return { ok: true, id: id != null ? String(id) : undefined };
    } catch {
      return { ok: false };
    } finally {
      client.close();
    }
  },

  async list(ctx: BackendContext) {
    const url = ctx.credentials.url;
    const token = ctx.credentials.authToken;
    if (!url || !token) return [];
    const { createClient } = await loadLibsql();
    const client = createClient({ url, authToken: token });
    try {
      const r = await client.execute(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);
      return r.rows.map((row: any) => ({
        id: row.name,
        name: row.name,
        type: "table",
      }));
    } catch {
      return [];
    } finally {
      client.close();
    }
  },
};

function quoteIdent(s: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error(`Invalid SQL identifier: ${s}`);
  }
  return `"${s}"`;
}
