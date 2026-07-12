/**
 * GET /api/session
 * ---------------------------------------------------------------------
 * Returns the authenticated user's profile + flags the UI needs to
 * stop lying. Specifically:
 *   - { user: { id, email, name, role } | null }
 *   - glmConfigured: boolean (ZAI_API_KEY set?)
 *   - voiceConfigured: boolean
 *   - billingConfigured: boolean
 *   - demoMode: boolean
 *
 * Demo mode is allowed only in non-production with ENABLE_DEMO_MODE=1.
 * In that case the route reports a synthetic demo user so the UI
 * shows "Demo" in the account menu instead of "Sign in".
 */

import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDemoModeAllowed, DEMO_USER_ID } from "@/lib/auth/require-user";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { isVoiceAvailable } from "@/lib/voice";
import { resolveEmbeddingProvider } from "@/lib/rag/embeddings";
import { resolveRagDriver } from "@/lib/rag/retriever";

export const runtime = "nodejs";

export async function GET() {
  const realUserId = await getCurrentUserId();
  const demoAllowed = isDemoModeAllowed();

  let user: { id: string; email: string; name: string | null; role: string } | null = null;

  if (realUserId) {
    const row = await db.user.findUnique({
      where: { id: realUserId },
      select: { id: true, email: true, name: true, role: true },
    });
    if (row) {
      user = { id: row.id, email: row.email, name: row.name, role: row.role };
    }
  } else if (demoAllowed) {
    // Reflect the synthetic demo user. /api/chat auto-creates this row
    // on first message in demo mode; if it doesn't exist yet we still
    // report it so the UI shows "Demo".
    const row = await db.user.findUnique({
      where: { id: DEMO_USER_ID },
      select: { id: true, email: true, name: true, role: true },
    });
    if (row) {
      user = { id: row.id, email: row.email, name: row.name, role: row.role };
    } else {
      user = { id: DEMO_USER_ID, email: "demo@local", name: "Demo", role: "OWNER" };
    }
  }

  return NextResponse.json({
    user,
    demoMode: demoAllowed && !realUserId,
    glmConfigured: Boolean(process.env.ZAI_API_KEY),
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    voiceConfigured: isVoiceAvailable(),
    billingConfigured: isBillingConfigured(),
    rag: {
      embeddingsProvider: resolveEmbeddingProvider(),
      driver: resolveRagDriver(),
    },
  });
}
