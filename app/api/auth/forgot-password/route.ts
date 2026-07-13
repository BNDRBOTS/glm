/**
 * POST /api/auth/forgot-password
 * ---------------------------------------------------------------------
 * Body: { email }
 *
 * ALWAYS returns { ok: true, message: "if the email exists, a reset
 * link has been sent" } — never leaks whether the email is registered.
 *
 * If the email IS registered:
 *   1. Generate a random token (32 bytes hex).
 *   2. Hash it (SHA-256) and store the hash in PasswordResetToken.
 *      The raw token is sent to the user via email but never stored.
 *   3. Invalidate any prior unused tokens for this user (one active
 *      reset at a time).
 *   4. Send the email via lib/email.ts (SMTP if configured, console
 *      fallback otherwise).
 *
 * Rate limited at 3/hour per IP via middleware.
 *
 * Token TTL: 1 hour.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { sendEmail, buildPasswordResetEmail } from "@/lib/email";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.toLowerCase().trim();

  if (!email) {
    // Same response shape as success — don't leak.
    return NextResponse.json({
      ok: true,
      message: "If the email is registered, a reset link has been sent.",
    });
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } });

  if (user) {
    try {
      // Generate raw token + hash. Store ONLY the hash — the raw token
      // goes out in the email and must never touch the database, or a
      // DB leak becomes an account-takeover kit. The legacy `token`
      // column (kept for schema compatibility) also stores the hash.
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      // Invalidate prior unused tokens for this user.
      await db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });

      // Opportunistic hygiene: purge tokens that expired over a day
      // ago (used or not) so the table stays bounded over years of use.
      await db.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });

      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          token: tokenHash,
          tokenHash,
          expiresAt,
        },
      });

      // Build the reset URL. NEXTAUTH_URL is the canonical origin.
      const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      const resetUrl = `${origin}/reset-password?token=${rawToken}`;

      const emailBody = buildPasswordResetEmail(resetUrl, user.email);
      await sendEmail({
        to: user.email,
        subject: emailBody.subject,
        text: emailBody.text,
        html: emailBody.html,
      });

      await logAudit({
        userId: user.id,
        source: "auth",
        event: "user.password_reset_requested",
        payload: { email: user.email },
      });
    } catch (e) {
      // If email sending fails (SMTP down), we still return the same
      // success message — never leak that the email failed to send.
      // Log loud so ops notices.
      console.error(`[forgot-password] failed for ${user.email}:`, e);
      await logAudit({
        userId: user.id,
        source: "auth",
        level: "error",
        event: "user.password_reset_send_failed",
        payload: { email: user.email, error: String(e) },
      });
    }
  }

  // Always the same response.
  return NextResponse.json({
    ok: true,
    message: "If the email is registered, a reset link has been sent.",
  });
}
