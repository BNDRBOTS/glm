#!/usr/bin/env node
/**
 * swap-prisma-provider.mjs
 * ---------------------------------------------------------------------
 * Prisma doesn't support `provider = env("DATABASE_PROVIDER")`.
 * This script swaps the `provider` line in prisma/schema.prisma
 * based on the DATABASE_URL scheme:
 *
 *   file:./...           → sqlite
 *   postgresql://...     → postgresql
 *   postgres://...       → postgresql
 *
 * Runs as part of `db:push`, `db:generate`, and `db:migrate` scripts
 * so deploys to Railway (which injects a Postgres DATABASE_URL) work
 * without manual schema edits.
 *
 * Idempotent — if the provider is already correct, exits with no change.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SCHEMA_PATH = resolve(process.cwd(), "prisma/schema.prisma");
const DB_URL = process.env.DATABASE_URL ?? "";

if (!existsSync(SCHEMA_PATH)) {
  console.error(`[swap-provider] schema not found at ${SCHEMA_PATH}`);
  process.exit(1);
}

let targetProvider;
if (DB_URL.startsWith("file:")) {
  targetProvider = "sqlite";
} else if (DB_URL.startsWith("postgresql://") || DB_URL.startsWith("postgres://")) {
  targetProvider = "postgresql";
} else {
  // Default — don't touch the schema if we can't infer intent.
  console.log(`[swap-provider] DATABASE_URL scheme unrecognized; leaving schema unchanged.`);
  process.exit(0);
}

const original = readFileSync(SCHEMA_PATH, "utf8");

// Only swap the datasource block's provider, not generator's.
const lines = original.split("\n");
let inDatasource = false;
let swapped = false;
let currentProvider = null;

const out = lines.map((line) => {
  if (/^\s*datasource\s+\w+\s*\{/.test(line)) {
    inDatasource = true;
    return line;
  }
  if (inDatasource && /^\s*\}/.test(line)) {
    inDatasource = false;
    return line;
  }
  if (inDatasource && /^\s*provider\s*=/.test(line)) {
    const m = line.match(/^\s*provider\s*=\s*"(\w+)"/);
    if (m) currentProvider = m[1];
    if (m && m[1] !== targetProvider) {
      swapped = true;
      return line.replace(/"(\w+)"/, `"${targetProvider}"`);
    }
    return line;
  }
  return line;
}).join("\n");

if (swapped) {
  writeFileSync(SCHEMA_PATH, out);
  console.log(`[swap-provider] provider: ${currentProvider} → ${targetProvider}`);
} else {
  console.log(`[swap-provider] provider already "${targetProvider}" — no change.`);
}
