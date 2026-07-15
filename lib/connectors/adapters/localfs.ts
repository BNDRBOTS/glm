import type { Connector, ConnectorContext } from "../registry";

/**
 * Local FS connector — direct access to a folder on your computer.
 * Set LOCAL_FS_ROOT to a folder. Connector reads/writes within it.
 *
 * SECURITY: path traversal is blocked — resolves against root and
 * rejects anything that escapes (path.relative containment, not a
 * startsWith prefix check which admits sibling dirs like `<root>-x`).
 */
import { promises as fs } from "fs";
import { resolveInsideRoot } from "@/lib/fs-boundary";

export const localfsConnector: Connector = {
  manifest: {
    id: "localfs",
    label: "Local Computer",
    description: "Connect to your computer directly. Read/write files from chat.",
    category: "DEV",
    authType: "none",
    iconKey: "localfs",
    envKey: "LOCAL_FS_ROOT",
    capabilities: { list: true, fetch: true, push: true },
  },

  async testConnection(ctx: ConnectorContext) {
    const root = ctx.credentials.root || process.env.LOCAL_FS_ROOT;
    if (!root) return { ok: false, message: "Set LOCAL_FS_ROOT to a folder on your computer." };
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) return { ok: false, message: "Path is not a directory." };
      return { ok: true, message: `Local FS root set: ${root}` };
    } catch (e) {
      return { ok: false, message: `Cannot access path: ${(e as Error).message}` };
    }
  },

  async list(ctx: ConnectorContext) {
    const root = ctx.credentials.root || process.env.LOCAL_FS_ROOT;
    if (!root) return [];
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      return entries.map((e) => ({
        id: e.name,
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
    } catch {
      return [];
    }
  },

  async fetch(ctx: ConnectorContext, id: string) {
    const root = ctx.credentials.root || process.env.LOCAL_FS_ROOT;
    if (!root) throw new Error("LOCAL_FS_ROOT not set — cannot resolve paths");
    const safe = resolveInsideRoot(root, id);
    const content = await fs.readFile(safe, "utf-8");
    return {
      id,
      title: id,
      content,
      fetchedAt: new Date().toISOString(),
    };
  },

  async push(ctx: ConnectorContext, resourceId: string, content: string) {
    const root = ctx.credentials.root || process.env.LOCAL_FS_ROOT;
    if (!root) throw new Error("LOCAL_FS_ROOT not set — cannot resolve paths");
    const safe = resolveInsideRoot(root, resourceId);
    await fs.writeFile(safe, content, "utf-8");
    return { ok: true, url: `file://${safe}` };
  },
};
