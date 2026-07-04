/**
 * Attachment storage helper.
 * ---------------------------------------------------------------------
 * Stores uploaded files for chat messages. Default backend is LOCAL
 * (file system) under ATTACHMENTS_DIR or ./.next/attachments as a
 * fallback. The Attachment row records storage + storageKey so a
 * future S3 swap is mechanical — only this file changes.
 *
 * SECURITY: filenames are sanitized + a random uuid is prepended so
 * two uploads with the same name never collide, and a malicious
 * filename can't traverse the filesystem.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

export type AttachmentStorage = "LOCAL" | "S3";

const DEFAULT_DIR = path.resolve(process.cwd(), ".next/attachments");

function getRoot(): string {
  const dir = process.env.ATTACHMENTS_DIR ?? DEFAULT_DIR;
  return path.resolve(dir);
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
  const full = path.resolve(root, storageKey);

  // Defense-in-depth: ensure resolved path stays inside root.
  if (!full.startsWith(root)) {
    throw new Error("Path traversal blocked");
  }

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
  const full = path.resolve(root, storageKey);
  if (!full.startsWith(root)) return null;
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
  const full = path.resolve(root, storageKey);
  if (!full.startsWith(root)) return;
  try {
    await fs.unlink(full);
  } catch {
    // ignore — file may already be gone
  }
}
