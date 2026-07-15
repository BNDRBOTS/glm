/**
 * Filesystem path-boundary guard.
 * ---------------------------------------------------------------------
 * Shared by attachment storage and the Local FS connector. The naive
 * `resolved.startsWith(root)` check has a subtle escape: with
 * root = "/data/attachments", the sibling "/data/attachments-evil/x"
 * also passes the prefix test. This helper does the check correctly
 * via path.relative(): a path is inside the root only when the
 * relative path from root to it does not climb upward and is not
 * absolute.
 */

import * as path from "path";

/**
 * True if `candidate` (already resolved or not) is the root itself or
 * strictly inside `root` after resolution.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const rel = path.relative(resolvedRoot, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve `candidate` against `root` and throw if it escapes.
 * Returns the resolved absolute path when safe.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (!isInsideRoot(resolvedRoot, resolved)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}
