/**
 * GLM Power Platform — Backend Integration System
 * ---------------------------------------------------------------------
 * Connects the app to data backends (Supabase, Neon, MongoDB,
 * Firebase, Turso). Different from connectors (which are external
 * services the AI can talk to) — backends are databases/storage the
 * app itself can use for persistence beyond the built-in Prisma DB.
 *
 * Use cases:
 *   - Mirror chat logs to Supabase for analytics
 *   - Push distilled facts to Neon for cross-app queries
 *   - Stream exports to MongoDB Atlas
 *   - Sync auth state to Firebase
 *   - Edge-cache hot paths in Turso (libSQL)
 *
 * Drop-in pattern: paste connection string + optional key, done.
 *
 * Free tiers as of 2026:
 *   Supabase   — 500MB DB, 50K MAU, 1GB storage
 *   Neon       — 0.5GB storage, 100 compute hours
 *   MongoDB    — 512MB Atlas free tier
 *   Firebase   — 1GB Firestore, 10K writes/day
 *   Turso      — 9GB total, 500 dbs, 1B row reads
 */

import "@/lib/server-guard";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type BackendType =
  | "supabase"
  | "neon"
  | "mongodb"
  | "firebase"
  | "turso";

export interface BackendManifest {
  id: BackendType;
  label: string;
  description: string;
  iconKey: string;
  /** Required credential fields the user must paste */
  requiredFields: BackendField[];
  /** Optional credential fields */
  optionalFields?: BackendField[];
  /** What this backend is good at */
  strengths: string[];
  /** Docs URL for getting credentials */
  docsUrl: string;
}

export interface BackendField {
  key: string;
  label: string;
  type: "string" | "password" | "url";
  placeholder?: string;
  required: boolean;
}

export interface BackendContext {
  credentials: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface BackendQueryResult {
  rows: Record<string, unknown>[];
  count: number;
  durationMs: number;
}

export interface Backend {
  manifest: BackendManifest;
  /** Test connection — returns ok + human message */
  testConnection(ctx: BackendContext): Promise<{ ok: boolean; message: string }>;
  /** Run a query against the backend (SQL for relational, JSON filter for Mongo) */
  query?(ctx: BackendContext, q: string, params?: unknown[]): Promise<BackendQueryResult>;
  /** Push a record to the backend */
  push?(ctx: BackendContext, table: string, record: Record<string, unknown>): Promise<{ ok: boolean; id?: string }>;
  /** List tables/collections */
  list?(ctx: BackendContext): Promise<{ id: string; name: string; type: string }[]>;
}

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

import { supabaseBackend } from "./adapters/supabase";
import { neonBackend } from "./adapters/neon";
import { mongodbBackend } from "./adapters/mongodb";
import { firebaseBackend } from "./adapters/firebase";
import { tursoBackend } from "./adapters/turso";

export const REGISTRY: Record<BackendType, Backend> = {
  supabase: supabaseBackend,
  neon: neonBackend,
  mongodb: mongodbBackend,
  firebase: firebaseBackend,
  turso: tursoBackend,
};

export function listBackends(): Backend[] {
  return Object.values(REGISTRY);
}

export function getBackend(id: BackendType): Backend | undefined {
  return REGISTRY[id];
}
