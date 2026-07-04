/**
 * Auth helpers for route handlers.
 * ---------------------------------------------------------------------
 * Centralizes the demo-mode + ownership pattern so every API route
 * uses the same rules. Previously each route fell back to the literal
 * string "demo-user" — which:
 *   1. Let anonymous users read/write "demo-user" data without auth.
 *   2. Crashed with Prisma FK violation on POST since "demo-user"
 *      doesn't exist as a User row (except after /api/chat auto-creates
 *      it with ENABLE_DEMO_MODE=1).
 *
 * `requireUser` returns the authenticated user id, or throws a 401
 * Response that the route can return directly. Demo mode is gated
 * behind ENABLE_DEMO_MODE=1 AND NODE_ENV !== "production".
 */

import { getCurrentUserId } from "./nextauth";

export const DEMO_USER_ID = "demo-user";

/**
 * Returns true if demo mode is allowed in the current environment.
 * Demo mode is INTENTIONALLY disabled in production regardless of the
 * env var — prevents accidental exposure if someone copies .env to
 * Railway.
 */
export function isDemoModeAllowed(): boolean {
  return process.env.ENABLE_DEMO_MODE === "1" && process.env.NODE_ENV !== "production";
}

/**
 * Resolve the effective user id for a request.
 *
 * - If authenticated: returns the real user id.
 * - If unauthenticated AND demo mode is allowed: returns DEMO_USER_ID.
 * - If unauthenticated AND demo mode is NOT allowed: returns null.
 *
 * Routes that mutate data should use `requireUser` instead, which
 * returns a 401 Response when access is denied.
 */
export async function resolveUserId(): Promise<string | null> {
  const real = await getCurrentUserId();
  if (real) return real;
  if (isDemoModeAllowed()) return DEMO_USER_ID;
  return null;
}

/**
 * Returns either the user id, or a 401 Response that the route handler
 * can return directly. Demo mode is allowed only when
 * ENABLE_DEMO_MODE=1 AND NODE_ENV !== "production".
 *
 *   const [userId, denied] = await requireUser();
 *   if (denied) return denied;
 *   // ... use userId
 */
export async function requireUser(): Promise<[string, null] | [null, Response]> {
  const userId = await resolveUserId();
  if (userId) return [userId, null];
  return [
    null,
    new Response(
      JSON.stringify({
        error: "Not authenticated. Sign in, or set ENABLE_DEMO_MODE=1 in dev.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    ),
  ];
}
