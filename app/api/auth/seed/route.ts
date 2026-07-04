/**
 * POST /api/auth/seed
 * ---------------------------------------------------------------------
 * Dev-only. Create the two starting accounts so you can log in.
 *
 * Security:
 *   - 404s when DISABLE_SEED=1 (railway production sets this).
 *   - 404s when NODE_ENV=production regardless of DISABLE_SEED.
 *   - Optionally requires SEED_TOKEN env var; if set, request must
 *     include matching `Authorization: Bearer <token>` header. Lets
 *     operators run a one-time bootstrap from a deploy script
 *     without leaving an open account-creation endpoint.
 *
 * Body: { email, password, name?, role?: "OWNER" | "BUDDY" | "MEMBER" }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

export async function POST(req: NextRequest) {
  // Hard gate 1: env flag
  if (process.env.DISABLE_SEED === "1") {
    return NextResponse.json({ error: "Seeding disabled in production" }, { status: 404 });
  }
  // Hard gate 2: never allow in production even if flag is wrong
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seeding disabled in production" }, { status: 404 });
  }
  // Hard gate 3: optional bearer token (if SEED_TOKEN is set)
  if (process.env.SEED_TOKEN) {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== process.env.SEED_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { email, password, name, role } = (await req.json()) as {
    email: string;
    password: string;
    name?: string;
    role?: "OWNER" | "BUDDY" | "MEMBER";
  };

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LEN} characters` },
      { status: 400 }
    );
  }
  if (role && !["OWNER", "BUDDY", "MEMBER"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const lowerEmail = email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email: lowerEmail } });
  if (existing) {
    return NextResponse.json({ ok: true, message: "Already exists", id: existing.id });
  }

  const user = await db.user.create({
    data: {
      email: lowerEmail,
      name: name ?? email.split("@")[0],
      passwordHash: hashPassword(password),
      role: role ?? "MEMBER",
    },
  });
  return NextResponse.json({ ok: true, id: user.id, email: user.email });
}
