/**
 * NextAuth config — Credentials provider.
 * Two fully separate accounts. Each user gets their own chats,
 * integrations, memory logs — nothing bleeds across.
 *
 * First-run: run `bun run db:push`, then create users via the
 * /api/auth/seed endpoint (dev only) or the UI (when built).
 *
 * Route handler at /api/auth/[...nextauth]/route.ts exports
 * NextAuth(authOptions) as GET + POST.
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "./password";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers: [
    CredentialsProvider({
      name: "Account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const email = creds.email.toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !verifyPassword(creds.password, user.passwordHash)) {
          // Audit failed attempts so brute-force patterns are visible.
          // Same log shape whether the account exists or not — the
          // audit trail must not become an account-enumeration oracle
          // if it's ever exposed more broadly.
          const { logAudit } = await import("@/lib/audit");
          await logAudit({
            userId: user?.id ?? null,
            source: "auth",
            level: "warn",
            event: "user.signin_failed",
            payload: { email },
          });
          return null;
        }
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  events: {
    async signIn({ user }) {
      const { logAudit } = await import("@/lib/audit");
      await logAudit({
        userId: user.id,
        source: "auth",
        event: "user.signin",
        payload: { email: user.email },
      });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).email = token.email;
        (session.user as any).name = token.name;
      }
      return session;
    },
  },
  secret: getAuthSecret(),
};

/**
 * Resolve the NextAuth secret. In production we fail fast — without a
 * real secret, JWTs are signed with a public default and any client
 * can forge a session for any user id. In dev/preview we fall back to
 * a deterministic value so the app still boots.
 */
function getAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  // `next build` evaluates this module during page-data collection with
  // NODE_ENV=production — throwing there means the app can't even BUILD
  // without production secrets present (breaks CI and any build step
  // that doesn't inject runtime env). Fail fast at SERVER BOOT instead:
  // NEXT_PHASE is only set during the build itself.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuildPhase) {
    throw new Error(
      "NEXTAUTH_SECRET must be set to a 16+ char random string in production. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  // Dev fallback — log loudly so it's never silently deployed.
  if (!secret) {
    console.warn(
      "[auth] NEXTAUTH_SECRET not set — using insecure dev default. " +
      "Set NEXTAUTH_SECRET in your environment before deploying."
    );
  }
  return "dev-secret-change-me";
}

/**
 * Get the current user id from a server action / route handler.
 * Returns null if not signed in.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { getServerSession } = await import("next-auth");
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.id ?? null;
}
