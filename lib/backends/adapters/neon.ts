import type { Backend, BackendContext, BackendQueryResult } from "../registry";
import "@/lib/server-guard";

/**
 * Neon backend — serverless Postgres. REAL implementation.
 * ---------------------------------------------------------------------
 * Connection string format:
 *   postgresql://user:pass@host/db?sslmode=require
 *
 * Free tier: 0.5GB storage, 100 compute hours/month.
 * Docs: https://neon.tech/docs/connect/connection-pooling
 *
 * `pg` is lazy-loaded inside function bodies so module import doesn't
 * pay the cost (and so test runners don't need it installed).
 *
 * Graceful fallback: if credentials are missing or invalid, returns
 * a structured error — never throws to the caller.
 */

// Cache the pool module so we only load it once per process
let _pg: typeof import("pg") | null = null;
async function loadPg() {
  if (!_pg) _pg = await import("pg");
  return _pg;
}

export const neonBackend: Backend = {
  manifest: {
    id: "neon",
    label: "Neon",
    description: "Serverless Postgres with branching. Free tier: 0.5GB, 100 compute hours.",
    iconKey: "neon",
    requiredFields: [
      { key: "connectionString", label: "Connection String", type: "password", placeholder: "postgresql://user:pass@host/db?sslmode=require", required: true },
    ],
    strengths: ["Postgres", "Branching", "Serverless", "Point-in-time recovery"],
    docsUrl: "https://neon.tech/docs/connect/connection-pooling",
  },

  async testConnection(ctx: BackendContext) {
    const cs = ctx.credentials.connectionString;
    if (!cs) return { ok: false, message: "Connection string required." };
    if (!cs.startsWith("postgresql://") && !cs.startsWith("postgres://")) {
      return { ok: false, message: "Must start with postgresql:// or postgres://" };
    }
    try {
      const { Pool } = await loadPg();
      const pool = new Pool({
        connectionString: cs,
        ssl: { rejectUnauthorized: false },
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 10000,
      });
      try {
        const r = await pool.query("SELECT 1 AS ok");
        if (r.rows.length === 1 && (r.rows[0] as any).ok === 1) {
          return { ok: true, message: "Neon connected." };
        }
        return { ok: false, message: "Unexpected response from Neon." };
      } finally {
        await pool.end();
      }
    } catch (e) {
      return { ok: false, message: `Neon error: ${(e as Error).message}` };
    }
  },

  async query(ctx: BackendContext, q: string, params?: unknown[]): Promise<BackendQueryResult> {
    const cs = ctx.credentials.connectionString;
    if (!cs) return { rows: [], count: 0, durationMs: 0 };
    const { Pool } = await loadPg();
    const pool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });
    const start = Date.now();
    try {
      const r = await pool.query(q, (params as any[]) ?? []);
      return {
        rows: r.rows,
        count: r.rowCount ?? 0,
        durationMs: Date.now() - start,
      };
    } finally {
      await pool.end();
    }
  },

  async push(ctx: BackendContext, table: string, record: Record<string, unknown>) {
    const cs = ctx.credentials.connectionString;
    if (!cs) return { ok: false };
    const { Pool } = await loadPg();
    const pool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });
    try {
      const cols = Object.keys(record);
      const vals = Object.values(record);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const r = await pool.query(
        `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders}) RETURNING id`,
        vals as any[]
      );
      const id = r.rows[0]?.id;
      return { ok: true, id: id != null ? String(id) : undefined };
    } catch {
      return { ok: false };
    } finally {
      await pool.end();
    }
  },

  async list(ctx: BackendContext) {
    const cs = ctx.credentials.connectionString;
    if (!cs) return [];
    const { Pool } = await loadPg();
    const pool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });
    try {
      const r = await pool.query(`
        SELECT table_name AS name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_name
        LIMIT 100
      `);
      return r.rows.map((row: any) => ({
        id: row.name,
        name: row.name,
        type: "table",
      }));
    } catch {
      return [];
    } finally {
      await pool.end();
    }
  },
};

function quoteIdent(s: string): string {
  // Strict identifier quoting — prevents SQL injection on table/column names
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error(`Invalid SQL identifier: ${s}`);
  }
  return `"${s}"`;
}
