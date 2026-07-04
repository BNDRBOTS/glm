/**
 * Server-only guard — testing-friendly.
 * ---------------------------------------------------------------------
 * In production (Next.js bundler), this is enforced by route handlers
 * being server-only by default + the bundler's own checks.
 *
 * In tests, we skip the throw so the modules can be imported directly.
 *
 * Replace `import "server-only"` with `import "@/lib/server-guard"` in
 * any module that should never run client-side.
 */

if (process.env.NODE_ENV === "production" && typeof window !== "undefined") {
  throw new Error(
    "This module is server-only. It cannot be imported from a Client Component."
  );
}

export {};
