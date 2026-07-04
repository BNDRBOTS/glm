import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Only log queries when explicitly requested via DEBUG_PRISMA=1.
// Default logging is warn+error only — query logging can leak
// sensitive SQL/params (e.g. credential lookups) into stdout and
// also severely degrades performance under load.
const logLevel: ("query" | "warn" | "error")[] =
  process.env.DEBUG_PRISMA === "1" ? ["query", "warn", "error"] : ["warn", "error"]

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevel,
  })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
