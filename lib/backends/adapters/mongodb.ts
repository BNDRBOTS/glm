import type { Backend, BackendContext, BackendQueryResult } from "../registry";
import "@/lib/server-guard";

/**
 * MongoDB Atlas backend. REAL implementation.
 * ---------------------------------------------------------------------
 * Connection string format:
 *   mongodb+srv://user:pass@cluster.x.mongodb.net/dbname
 *
 * Free tier: 512MB shared cluster.
 * Docs: https://www.mongodb.com/docs/atlas/connect-to-standard-deployment/
 *
 * Query format: "database/collection/filterJson"
 *   e.g. "myapp/users/{\"active\":true}"
 *
 * `mongodb` is lazy-loaded inside function bodies.
 */

let _mongo: typeof import("mongodb") | null = null;
async function loadMongo() {
  if (!_mongo) _mongo = await import("mongodb");
  return _mongo;
}

export const mongodbBackend: Backend = {
  manifest: {
    id: "mongodb",
    label: "MongoDB Atlas",
    description: "Document database. Free tier: 512MB shared cluster.",
    iconKey: "mongodb",
    requiredFields: [
      { key: "connectionString", label: "Connection String", type: "password", placeholder: "mongodb+srv://user:pass@cluster.x.mongodb.net/db", required: true },
    ],
    strengths: ["Document DB", "Flexible schema", "Aggregation pipeline", "Atlas Search"],
    docsUrl: "https://www.mongodb.com/docs/atlas/connect-to-standard-deployment/",
  },

  async testConnection(ctx: BackendContext) {
    const cs = ctx.credentials.connectionString;
    if (!cs) return { ok: false, message: "Connection string required." };
    if (!cs.startsWith("mongodb://") && !cs.startsWith("mongodb+srv://")) {
      return { ok: false, message: "Must start with mongodb:// or mongodb+srv://" };
    }
    try {
      const { MongoClient } = await loadMongo();
      const client = new MongoClient(cs, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
      try {
        await client.connect();
        await client.db().command({ ping: 1 });
        return { ok: true, message: "MongoDB connected." };
      } finally {
        await client.close();
      }
    } catch (e) {
      return { ok: false, message: `MongoDB error: ${(e as Error).message}` };
    }
  },

  async query(ctx: BackendContext, q: string): Promise<BackendQueryResult> {
    const cs = ctx.credentials.connectionString;
    if (!cs) return { rows: [], count: 0, durationMs: 0 };
    const parsed = parseMongoQuery(q);
    if (!parsed) return { rows: [], count: 0, durationMs: 0 };
    const { MongoClient } = await loadMongo();
    const client = new MongoClient(cs, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    const start = Date.now();
    try {
      await client.connect();
      const cursor = client.db(parsed.db).collection(parsed.collection).find(parsed.filter).limit(100);
      const rows = await cursor.toArray();
      return {
        rows: rows as Record<string, unknown>[],
        count: rows.length,
        durationMs: Date.now() - start,
      };
    } finally {
      await client.close();
    }
  },

  async push(ctx: BackendContext, table: string, record: Record<string, unknown>) {
    const cs = ctx.credentials.connectionString;
    if (!cs) return { ok: false };
    const [db, collection] = table.split("/");
    if (!db || !collection) return { ok: false };
    const { MongoClient } = await loadMongo();
    const client = new MongoClient(cs, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    try {
      await client.connect();
      const r = await client.db(db).collection(collection).insertOne(record);
      return { ok: true, id: String(r.insertedId) };
    } catch {
      return { ok: false };
    } finally {
      await client.close();
    }
  },

  async list(ctx: BackendContext) {
    const cs = ctx.credentials.connectionString;
    if (!cs) return [];
    const { MongoClient } = await loadMongo();
    const client = new MongoClient(cs, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    try {
      await client.connect();
      const defaultDb = extractDbFromConnString(cs);
      if (!defaultDb) return [];
      const collections = await client.db(defaultDb).listCollections().toArray();
      return collections.map((c: any) => ({
        id: `${defaultDb}/${c.name}`,
        name: c.name,
        type: "collection",
      }));
    } catch {
      return [];
    } finally {
      await client.close();
    }
  },
};

function parseMongoQuery(q: string): { db: string; collection: string; filter: Record<string, unknown> } | null {
  const parts = q.split("/");
  if (parts.length < 2) return null;
  const [db, collection, ...filterParts] = parts;
  const filterJson = filterParts.join("/");
  let filter: Record<string, unknown> = {};
  if (filterJson) {
    try {
      filter = JSON.parse(filterJson);
    } catch {
      return null;
    }
  }
  return { db, collection, filter };
}

function extractDbFromConnString(cs: string): string | null {
  try {
    const u = new URL(cs);
    const db = u.pathname.slice(1);
    return db || null;
  } catch {
    return null;
  }
}
