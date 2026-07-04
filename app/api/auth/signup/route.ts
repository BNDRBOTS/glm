/**
 * POST /api/auth/signup
 * ---------------------------------------------------------------------
 * Self-service account creation. Body: { email, password, name? }
 *
 * Validation:
 *   - Email format (RFC-simple regex)
 *   - Password >= 8 chars (matches the seed endpoint policy)
 *   - Email lowercased + trimmed
 *
 * Rate limited at 3/hour per IP via middleware.ts (RATE_LIMITS key).
 *
 * Returns: { ok: true, userId, email } on success.
 *          { ok: false, error } on validation failure or duplicate.
 *
 * The duplicate-email case returns a 409 with a clear message — we
 * DON'T obscure it (unlike forgot-password) because the user already
 * knows the email they typed; obscuring it would just confuse them.
 *
 * After signup the client immediately calls NextAuth signIn() to
 * establish a session — no email verification step.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_NAME_LEN = 100;

export async function POST(req: NextRequest) {
  // Block in production if signups are explicitly disabled.
  if (process.env.DISABLE_SIGNUP === "1") {
    return NextResponse.json(
      { ok: false, error: "Sign-ups are disabled on this instance." },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };

  const email = body.email?.toLowerCase().trim();
  const password = body.password;
  const name = body.name?.trim();

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Invalid email format." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { ok: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 }
    );
  }
  if (name && name.length > MAX_NAME_LEN) {
    return NextResponse.json({ ok: false, error: "Name is too long." }, { status: 400 });
  }

  // Check for existing email — Prisma @unique throws P2002 on race, so
  // we also catch that below.
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  try {
    const user = await db.user.create({
      data: {
        email,
        name: name ?? email.split("@")[0],
        passwordHash: hashPassword(password),
        role: "MEMBER",
      },
      select: { id: true, email: true, name: true },
    });

    await logAudit({
      userId: user.id,
      source: "auth",
      event: "user.signup",
      payload: { email: user.email, name: user.name },
    });

    return NextResponse.json({ ok: true, userId: user.id, email: user.email });
  } catch (e: any) {
    // Prisma P2002 = unique constraint violation (race condition with
    // the findUnique above).
    if (e?.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "An account with this email already exists." },
        { status: 409 }
      );
    }
    console.error("[signup] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: "Account creation failed. Please try again." },
      { status: 500 }
    );
  }
}
