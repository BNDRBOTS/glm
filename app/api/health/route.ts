/**
 * GET /api/health — Railway healthcheck + dependency status
 * ---------------------------------------------------------------------
 * Returns 200 if the app is alive (always, as long as the route runs).
 * The body includes per-dependency status so operators can see what's
 * degraded without SSH'ing in.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     ts: 1234567890,
 *     deps: {
 *       database: "ok" | "down" | "unknown",
 *       redis: "ok" | "fallback" | "down",
 *       glm: "configured" | "missing",
 *       stripe: "configured" | "missing",
 *       email: "configured" | "fallback"
 *     }
 *   }
 *
 * Railway's healthcheck only needs a 2xx — the deps object is for
 * humans. This route is EXCLUDED from rate limiting (see middleware.ts)
 * because Railway pings it every few seconds.
 */

import { db } from "@/lib/db";
import { getRedisStatus } from "@/lib/redis";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { isVoiceAvailable } from "@/lib/voice";
import { getEmailStatus } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DepStatus = "ok" | "fallback" | "down" | "configured" | "missing" | "unknown";

export async function GET() {
  const deps: Record<string, DepStatus> = {};

  // Database — try a trivial query.
  try {
    await db.$queryRaw`SELECT 1`;
    deps.database = "ok";
  } catch {
    deps.database = "down";
  }

  // Redis — configured + connected?
  const redisStatus = getRedisStatus();
  deps.redis = redisStatus.configured
    ? redisStatus.connected
      ? "ok"
      : "fallback"
    : "fallback";

  // GLM (ZAI_API_KEY)
  deps.glm = Boolean(process.env.ZAI_API_KEY) ? "configured" : "missing";

  // Voice (ZAI_API_KEY or OPENAI_API_KEY)
  deps.voice = isVoiceAvailable() ? "configured" : "missing";

  // Stripe
  deps.stripe = isBillingConfigured() ? "configured" : "missing";

  // Email
  deps.email = getEmailStatus().configured ? "configured" : "fallback";

  // Overall ok: app is alive. Database being down is the only thing
  // that would make the app non-functional — but Railway just needs a
  // 2xx to keep the container running, so we return 200 with the
  // degraded status visible in the body.
  const allOk = deps.database === "ok";
  return Response.json(
    { ok: allOk, ts: Date.now(), deps },
    { status: allOk ? 200 : 503 }
  );
}
