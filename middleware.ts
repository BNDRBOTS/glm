/**
 * Next.js middleware.
 * ---------------------------------------------------------------------
 * Runs on every request before the route handler. Currently:
 *   1. Resolves the client IP (X-Forwarded-For or connection remote).
 *   2. Resolves the userId from the NextAuth session JWT (without
 *      verifying — verification happens in the route; we just need
 *      the id for rate-limit keying).
 *   3. Checks the rate limit for /api/* routes.
 *   4. On exceeded: returns 429 with Retry-After + X-RateLimit-* headers.
 *
 * Public routes that skip rate limiting:
 *   - /api/health (Railway healthcheck pings this constantly)
 *   - /_next/* (Next.js static assets)
 *   - /signin, /signup, /forgot-password, /reset-password (GET only —
 *     the POST variants ARE limited via the auth buckets above)
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";

export const config = {
  matcher: [
    // Match all API routes + auth pages
    "/api/:path*",
  ],
};

export async function middleware(req: NextRequest) {
  // Skip health — Railway pings it every few seconds, would burn limit.
  if (req.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  const ip = getClientIp(req);
  const userId = await getSessionFingerprint(req);
  const method = req.method;
  const path = req.nextUrl.pathname;

  const result = await checkRateLimit({ method, path, userId, ip });

  // Always set rate-limit headers so clients can self-throttle.
  const headers = new Headers({
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
  });

  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    headers.set("Retry-After", String(retryAfterSec));
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfter: retryAfterSec,
        limit: result.limit,
      },
      { status: 429, headers }
    );
  }

  return NextResponse.next({ headers });
}

/**
 * Resolve client IP. Behind Railway/Caddy the real IP is in
 * X-Forwarded-For (first entry) or X-Real-IP. Falls back to the
 * socket address if neither is set (direct localhost dev).
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  // Next.js doesn't expose socket addr directly in middleware, but
  // the request IP is usually one of the above headers in any
  // proxied deployment. Localhost dev just gets "127.0.0.1".
  return "127.0.0.1";
}

/**
 * Derive a stable per-session subject for rate-limit keying.
 *
 * NextAuth v4's session cookie is NOT a 3-part JWS — it's an encrypted
 * JWE (5 base64url segments), so the previous "decode the JWT payload"
 * approach always returned null and every "user"-scoped limit silently
 * degraded to per-IP keying. Decrypting the JWE in middleware would
 * drag key-derivation into the hot path; instead we key by a SHA-256
 * fingerprint of the session cookie itself. That is exactly as stable
 * as the session (one bucket per signed-in session), never exposes the
 * raw token in bucket names/logs, and requires no crypto secrets here.
 * Requests without a session cookie fall back to IP-based limiting.
 */
async function getSessionFingerprint(req: NextRequest): Promise<string | null> {
  // Check both cookie names — deployments behind TLS use the
  // __Secure- prefix, local dev does not. Checking both is robust to
  // NODE_ENV mismatches.
  const cookie =
    req.cookies.get("__Secure-next-auth.session-token")?.value ??
    req.cookies.get("next-auth.session-token")?.value;
  if (!cookie) return null;
  try {
    const data = new TextEncoder().encode(cookie);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sess:${hex.slice(0, 32)}`;
  } catch {
    return null;
  }
}
