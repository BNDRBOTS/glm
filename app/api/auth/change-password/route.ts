/**
 * POST /api/auth/change-password
 * ---------------------------------------------------------------------
 * Body: { currentPassword, newPassword }
 *
 * Requires an authenticated session (NOT demo mode — demo users have
 * no real password and shouldn't be able to set one).
 *
 * Verifies the current password before accepting the new one. This
 * prevents a stolen session cookie from being used to lock the user
 * out of their own account.
 *
 * On success: updates passwordHash, logs the event, returns ok.
 * Does NOT sign out other sessions — the user's existing JWT continues
 * to work until expiry. (See reset-password route for the same note.)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getCurrentUserId } from "@/lib/auth/nextauth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const MIN_PASSWORD_LEN = 8;

export async function POST(req: NextRequest) {
  // Require a REAL authenticated user — demo mode is forbidden here
  // because demo users have passwordHash: "demo-no-auth" which would
  // never verify and shouldn't be changeable.
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Sign in to change your password." },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };

  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { ok: false, error: "Current and new passwords are required." },
      { status: 400 }
    );
  }
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { ok: false, error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 }
    );
  }
  if (currentPassword === newPassword) {
    return NextResponse.json(
      { ok: false, error: "New password must be different from your current one." },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
  }

  // Verify current password.
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    // Log the failed attempt so brute-force patterns are visible.
    await logAudit({
      userId,
      source: "auth",
      level: "warn",
      event: "user.password_change_failed",
      payload: { reason: "wrong_current_password" },
    });
    return NextResponse.json(
      { ok: false, error: "Current password is incorrect." },
      { status: 403 }
    );
  }

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(newPassword) },
  });

  await logAudit({
    userId,
    source: "auth",
    event: "user.password_changed",
    payload: { email: user.email },
  });

  return NextResponse.json({ ok: true });
}
