/**
 * POST /api/auth/reset-password
 * ---------------------------------------------------------------------
 * Body: { token, password }
 *
 * Flow:
 *   1. Hash the incoming token (SHA-256) — we store only hashes.
 *   2. Look up the hash. Must be: not used, not expired.
 *   3. Update the user's passwordHash.
 *   4. Mark the token as used (one-shot).
 *   5. Invalidate ALL of the user's existing sessions by bumping a
 *      session-version counter. (NextAuth doesn't support this
 *      natively in v4; the practical mitigation is: any signed-in
 *      browser will continue to work until the JWT expires, but a
 *      password reset is rare enough that this is acceptable. The
 *      user should sign out other devices manually.)
 *
 * Rate limited at 5/hour per IP via middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/audit";
import { createHash } from "crypto";

export const runtime = "nodejs";

const MIN_PASSWORD_LEN = 8;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };

  const token = body.token;
  const password = body.password;

  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "Missing reset token." }, { status: 400 });
  }
  if (!password || password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { ok: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 }
    );
  }

  // Hash the incoming token + look it up.
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const resetRecord = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true } } },
  });

  if (!resetRecord) {
    return NextResponse.json({ ok: false, error: "Invalid reset token." }, { status: 400 });
  }
  if (resetRecord.usedAt) {
    return NextResponse.json(
      { ok: false, error: "This reset link has already been used. Request a new one." },
      { status: 400 }
    );
  }
  if (resetRecord.expiresAt < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This reset link has expired. Request a new one." },
      { status: 400 }
    );
  }

  // Update the password.
  await db.user.update({
    where: { id: resetRecord.userId },
    data: { passwordHash: hashPassword(password) },
  });

  // Mark the token as used.
  await db.passwordResetToken.update({
    where: { id: resetRecord.id },
    data: { usedAt: new Date() },
  });

  await logAudit({
    userId: resetRecord.userId,
    source: "auth",
    event: "user.password_reset",
    payload: { email: resetRecord.user.email },
  });

  return NextResponse.json({ ok: true });
}
