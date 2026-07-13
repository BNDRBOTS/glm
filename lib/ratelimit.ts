/**
 * Sliding-window rate limiter.
 * ---------------------------------------------------------------------
 * Backed by Redis (atomic INCR + EXPIRE via Lua script) when REDIS_URL
 * is set, in-memory Map otherwise. Both paths expose the same
 * `rateLimit()` interface.
 *
 * Failsafe policy: if the limiter itself throws (Redis down, etc.),
 * we ALLOW the request. Rationale: it's better to risk a brief
 * over-allow during a Redis outage than to take the whole app down
 * because the rate limiter can't reach its backend. Every failure is
 * logged via console.warn so operators see it.
 *
 * Limits are defined per-route-bucket. Buckets are matched by URL
 * prefix in middleware.ts. Each bucket has:
 *   - max: max requests in the window
 *   - windowSec: window size in seconds
 *   - scope: "user" | "ip" — whether to key by authenticated user or
 *            by client IP. Auth endpoints (signin/signup) use IP
 *            because there's no user yet; everything else uses user.
 */

import "@/lib/server-guard";
import { getRedis } from "./redis";

export interface RateLimit {
  max: number;
  windowSec: number;
  scope: "user" | "ip";
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  // Auth — strict per-IP to slow brute force.
  // NOTE: NextAuth's credentials sign-in actually POSTs to
  // /api/auth/callback/credentials — that bucket is the one that
  // protects password guessing. /api/auth/signin is kept for direct
  // hits on the NextAuth signin endpoint.
  "POST:/api/auth/callback/credentials": { max: 5, windowSec: 60, scope: "ip" },
  "POST:/api/auth/signin": { max: 5, windowSec: 60, scope: "ip" },
  "POST:/api/auth/signup": { max: 3, windowSec: 3600, scope: "ip" },
  "POST:/api/auth/forgot-password": { max: 3, windowSec: 3600, scope: "ip" },
  "POST:/api/auth/reset-password": { max: 5, windowSec: 3600, scope: "ip" },
  "POST:/api/auth/seed": { max: 5, windowSec: 3600, scope: "ip" },
  // Sensitive account mutations — authenticated, but still bounded so
  // a stolen session can't brute-force the current password or spam
  // destructive endpoints.
  "POST:/api/auth/change-password": { max: 5, windowSec: 3600, scope: "user" },
  "POST:/api/auth/delete-account": { max: 3, windowSec: 3600, scope: "user" },

  // Expensive AI routes — per-user
  "POST:/api/chat": { max: 30, windowSec: 60, scope: "user" },
  "POST:/api/voice/transcribe": { max: 10, windowSec: 60, scope: "user" },
  "POST:/api/exports": { max: 10, windowSec: 60, scope: "user" },
  "POST:/api/billing/checkout": { max: 5, windowSec: 300, scope: "user" },

  // Default for all other /api/* — generous
  default: { max: 120, windowSec: 60, scope: "user" },
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
}

/**
 * Check the rate limit for a (method, path, userId, ip) tuple.
 *
 * Falls open (allows) if the limiter fails — see failsafe policy above.
 */
export async function checkRateLimit(opts: {
  method: string;
  path: string;
  userId: string | null;
  ip: string;
}): Promise<RateLimitResult> {
  const key = `${opts.method}:${opts.path}`;
  const limit = RATE_LIMITS[key] ?? RATE_LIMITS.default;

  // Build the bucket key. User-scoped when authenticated, IP-scoped
  // otherwise (or when the limit explicitly says "ip").
  const scopeId = limit.scope === "user" && opts.userId
    ? `user:${opts.userId}`
    : `ip:${opts.ip}`;
  const bucket = `ratelimit:${scopeId}:${key}`;

  try {
    const redis = await getRedis();
    const count = await redis.incr(bucket, limit.windowSec);
    const allowed = count <= limit.max;

    // If over limit, compute resetAt from TTL. We don't have a TTL
    // command in the RedisLike interface, so we approximate: if
    // disallowed, reset is windowSec from now (worst case).
    const resetAt = Date.now() + limit.windowSec * 1000;

    return {
      allowed,
      limit: limit.max,
      remaining: Math.max(0, limit.max - count),
      resetAt,
    };
  } catch (e) {
    // Failsafe: allow the request, log loudly.
    console.warn(
      `[ratelimit] check failed for ${bucket}: ${(e as Error).message} — allowing request (failsafe)`
    );
    return {
      allowed: true,
      limit: limit.max,
      remaining: limit.max,
      resetAt: Date.now() + limit.windowSec * 1000,
    };
  }
}
