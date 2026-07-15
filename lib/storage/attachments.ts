/**
 * Attachment storage helper.
 * ---------------------------------------------------------------------
 * Stores uploaded files for chat messages. Default backend is LOCAL
 * (file system) under ATTACHMENTS_DIR or ./data/attachments as a
 * fallback. The Attachment row records storage + storageKey so a
 * future S3 swap is mechanical — only this file changes.
 *
 * PERSISTENCE: the default directory intentionally lives OUTSIDE
 * .next/ — the build output is deleted and recreated on every
 * `next build`, so anything stored there is silently wiped on each
 * deploy. `data/attachments` survives rebuilds; on Railway mount a
 * volume at ATTACHMENTS_DIR for durability across container restarts.
 *
 * SECURITY: filenames are sanitized + a random uuid is prepended so
 * two uploads with the same name never collide, and a malicious
 * filename can't traverse the filesystem. Path containment uses
 * path.relative (see lib/fs-boundary.ts) — a plain startsWith prefix
 * check would accept sibling directories like `<root>-evil`.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { isInsideRoot, resolveInsideRoot } from "@/lib/fs-boundary";

export type AttachmentStorage = "LOCAL" | "S3";

// Statically scoped join so Turbopack's file tracer doesn't try to
// trace the whole project directory into the build output.
const DEFAULT_DIR = path.join(process.cwd(), "data", "attachments");

function getRoot(): string {
  // Keep the statically-scoped default OUT of any dynamic path
  // expression: when the project-root-derived constant flows through
  // path.resolve with a runtime value, Turbopack's file tracer
  // concludes the route may read anywhere under the project and drags
  // the whole repo into the standalone output (NFT warning). The env
  // branch is purely runtime data, which the tracer ignores.
  const custom = process.env.ATTACHMENTS_DIR;
  return custom ? path.resolve(custom) : DEFAULT_DIR;
}

async function ensureRoot(): Promise<string> {
  const root = getRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

function sanitizeFilename(name: string): string {
  // Strip path separators, null bytes, leading dots. Keep extension.
  const base = path.basename(name).replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "");
  return base.slice(0, 100) || "attachment";
}

export interface StoredAttachment {
  filename: string;
  mimeType: string;
  size: number;
  storage: AttachmentStorage;
  storageKey: string;
}

/**
 * Store a Buffer under the attachments root. Returns the metadata
 * needed to create an Attachment row.
 */
export async function storeAttachment(
  filename: string,
  mimeType: string,
  data: Buffer
): Promise<StoredAttachment> {
  const root = await ensureRoot();
  const safeName = sanitizeFilename(filename);
  const id = randomUUID();
  const storageKey = `${id}-${safeName}`;

  // Defense-in-depth: ensure resolved path stays inside root.
  const full = resolveInsideRoot(root, storageKey);

  await fs.writeFile(full, data);
  return {
    filename: safeName,
    mimeType: mimeType || "application/octet-stream",
    size: data.length,
    storage: "LOCAL",
    storageKey,
  };
}

/**
 * Read an attachment back from disk. Returns null if missing.
 */
export async function readAttachment(storageKey: string): Promise<Buffer | null> {
  const root = getRoot();
  if (!isInsideRoot(root, storageKey)) return null;
  const full = path.resolve(root, storageKey);
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}

/**
 * Delete an attachment. Used when a chat (and its attachments) is deleted.
 * The Attachment row's onDelete: Cascade handles the DB row; this
 * cleans the file on disk.
 */
export async function deleteAttachment(storageKey: string): Promise<void> {
  const root = getRoot();
  if (!isInsideRoot(root, storageKey)) return;
  const full = path.resolve(root, storageKey);
  try {
    await fs.unlink(full);
  } catch {
    // ignore — file may already be gone
  }
}

/**
 * Best-effort disk cleanup for a batch of attachment rows. Never
 * throws — orphaned files are a hygiene issue, not a correctness one,
 * and the caller (chat/account deletion) must not fail because of a
 * missing file.
 */
export async function deleteAttachmentFiles(
  rows: { storage: string; storageKey: string }[]
): Promise<void> {
  for (const row of rows) {
    if (row.storage !== "LOCAL") continue;
    try {
      await deleteAttachment(row.storageKey);
    } catch {
      // best-effort
    }
  }
}
