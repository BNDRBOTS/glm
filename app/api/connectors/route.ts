/**
 * GET  /api/connectors  — list all registered connectors
 * POST /api/connectors  — save credentials + test connection
 *
 * Connector categories are returned so the UI can group them.
 */

import { NextRequest, NextResponse } from "next/server";
import { listConnectors, getConnector, type ConnectorContext } from "@/lib/connectors/registry";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/auth/crypto";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const connectors = listConnectors().map((c) => ({
    id: c.manifest.id,
    label: c.manifest.label,
    description: c.manifest.description,
    category: c.manifest.category,
    authType: c.manifest.authType,
    iconKey: c.manifest.iconKey,
    authUrl: c.manifest.authUrl,
    capabilities: c.manifest.capabilities,
    hasKey: false,
    enabled: true,
  }));

  // Mark which ones have saved keys for THIS user
  const saved = await db.integration.findMany({ where: { userId: userId! } });
  for (const s of saved) {
    const c = connectors.find((x) => x.id === s.provider);
    if (c) c.hasKey = true;
  }

  return NextResponse.json({ connectors });
}

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const { provider, credentials } = (await req.json()) as {
    provider: string;
    credentials: Record<string, string>;
  };

  if (!provider || typeof provider !== "string") {
    return NextResponse.json({ ok: false, message: "Missing provider" }, { status: 400 });
  }
  if (!credentials || typeof credentials !== "object") {
    return NextResponse.json({ ok: false, message: "Missing credentials" }, { status: 400 });
  }

  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ ok: false, message: "Unknown connector" }, { status: 400 });
  }

  // Save credentials (encrypted)
  const enc = await encrypt(JSON.stringify(credentials));
  await db.integration.upsert({
    where: { userId_provider: { userId: userId!, provider } },
    create: { userId: userId!, provider, credentials: enc, enabled: true },
    update: { credentials: enc, enabled: true },
  });

  // Test connection
  const ctx: ConnectorContext = { credentials };
  const result = await connector.testConnection(ctx);
  return NextResponse.json(result);
}
