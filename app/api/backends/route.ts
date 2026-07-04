/**
 * GET  /api/backends  — list all registered backends
 * POST /api/backends  — save credentials + test connection
 */

import { NextRequest, NextResponse } from "next/server";
import { listBackends, getBackend, type BackendType, type BackendContext } from "@/lib/backends/registry";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/auth/crypto";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

// Reuse the Integration table (provider field stores backend id with
// prefix "backend:" so they're namespaced separately from connectors)
const PREFIX = "backend:";

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const backends = listBackends().map((b) => ({
    id: b.manifest.id,
    label: b.manifest.label,
    description: b.manifest.description,
    iconKey: b.manifest.iconKey,
    strengths: b.manifest.strengths,
    docsUrl: b.manifest.docsUrl,
    requiredFields: b.manifest.requiredFields,
    optionalFields: b.manifest.optionalFields ?? [],
    hasCredentials: false,
  }));

  const saved = await db.integration.findMany({
    where: { userId: userId!, provider: { startsWith: PREFIX } },
  });
  for (const s of saved) {
    const backendId = s.provider.slice(PREFIX.length) as BackendType;
    const b = backends.find((x) => x.id === backendId);
    if (b) b.hasCredentials = true;
  }

  return NextResponse.json({ backends });
}

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const { backendId, credentials } = (await req.json()) as {
    backendId: BackendType;
    credentials: Record<string, string>;
  };

  if (!backendId) {
    return NextResponse.json({ ok: false, message: "Missing backendId" }, { status: 400 });
  }
  if (!credentials || typeof credentials !== "object") {
    return NextResponse.json({ ok: false, message: "Missing credentials" }, { status: 400 });
  }

  const backend = getBackend(backendId);
  if (!backend) {
    return NextResponse.json({ ok: false, message: "Unknown backend" }, { status: 400 });
  }

  const enc = await encrypt(JSON.stringify(credentials));
  const providerKey = `${PREFIX}${backendId}`;
  await db.integration.upsert({
    where: { userId_provider: { userId: userId!, provider: providerKey } },
    create: { userId: userId!, provider: providerKey, credentials: enc, enabled: true },
    update: { credentials: enc, enabled: true },
  });

  const ctx: BackendContext = { credentials };
  const result = await backend.testConnection(ctx);
  return NextResponse.json(result);
}
