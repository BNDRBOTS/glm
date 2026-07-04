/**
 * NextAuth route handler.
 * ---------------------------------------------------------------------
 * Without this file, /api/auth/* all return 404 and auth is
 * non-functional. The app only worked via ENABLE_DEMO_MODE=1.
 *
 * Now: /api/auth/signin, /api/auth/signout, /api/auth/session, etc.
 * all work correctly.
 */

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
