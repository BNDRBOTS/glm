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
        const user = await db.user.findUnique({
          where: { email: creds.email.toLowerCase() },
        });
        if (!user) return null;
        const ok = verifyPassword(creds.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
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
  if (process.env.NODE_ENV === "production") {
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
