/**
 * GLM Power Platform — Connector System
 * ---------------------------------------------------------------------
 * Extensible connector registry. Every external service the app talks
 * to is a Connector. Adding a new one = implement Connector, register
 * it in REGISTRY. UI auto-discovers.
 *
 * Categories:
 *   - LEGAL_RESEARCH  : CourtListener, Midpage, Courtroom5
 *   - DEV             : GitHub, Local FS
 *   - PRODUCTIVITY    : Notion
 *   - (extensible)
 *
 * Each connector is a self-contained adapter file in ./adapters/.
 */

import "@/lib/server-guard";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type ConnectorCategory =
  | "LEGAL_RESEARCH"
  | "DEV"
  | "PRODUCTIVITY"
  | "DATA"
  | "CUSTOM";

export type ConnectorAuthType =
  | "api_key"      // single key in `token` field
  | "oauth"        // future
  | "none";        // public API, no auth

export interface ConnectorManifest {
  id: string;                      // unique slug
  label: string;
  description: string;
  category: ConnectorCategory;
  authType: ConnectorAuthType;
  iconKey: string;                 // matches SVG in components/icons
  envKey?: string;                 // fallback env var name
  authUrl?: string;                // docs URL for getting a key
  /** Default base URL (override-able in connector config) */
  baseUrl?: string;
  /** Capabilities the connector supports */
  capabilities: {
    search?: boolean;
    fetch?: boolean;
    list?: boolean;
    push?: boolean;
    query?: boolean;
  };
}

export interface ConnectorContext {
  credentials: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface ConnectorSearchResult {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface ConnectorFetchResult {
  id: string;
  title: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
  fetchedAt: string;
}

export interface Connector {
  manifest: ConnectorManifest;
  /** Test connection — returns ok + human message */
  testConnection(ctx: ConnectorContext): Promise<{ ok: boolean; message: string }>;
  /** Search the upstream service */
  search?(ctx: ConnectorContext, query: string, opts?: { limit?: number }): Promise<ConnectorSearchResult[]>;
  /** Fetch a single resource by ID */
  fetch?(ctx: ConnectorContext, id: string): Promise<ConnectorFetchResult>;
  /** List resources (e.g., repos, workspaces, cases) */
  list?(ctx: ConnectorContext): Promise<{ id: string; name: string; type: string }[]>;
  /** Push content to the upstream service */
  push?(ctx: ConnectorContext, resourceId: string, content: string): Promise<{ ok: boolean; url?: string }>;
}

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

import { notionConnector } from "./adapters/notion";
import { githubConnector } from "./adapters/github";
import { courtroom5Connector } from "./adapters/courtroom5";
import { localfsConnector } from "./adapters/localfs";
import { courtlistenerConnector } from "./adapters/courtlistener";
import { midpageConnector } from "./adapters/midpage";

export const REGISTRY: Record<string, Connector> = {
  notion: notionConnector,
  github: githubConnector,
  courtroom5: courtroom5Connector,
  localfs: localfsConnector,
  courtlistener: courtlistenerConnector,
  midpage: midpageConnector,
};

export function listConnectors(): Connector[] {
  return Object.values(REGISTRY);
}

export function getConnector(id: string): Connector | undefined {
  return REGISTRY[id];
}
