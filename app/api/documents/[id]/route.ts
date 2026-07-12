/**
 * /api/documents/[id]
 * ---------------------------------------------------------------------
 * GET    — document detail (metadata + chunk stats), owner-only
 * DELETE — remove document + chunks (DB cascade) + stored file +
 *          pgvector mirror rows. Owner-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";
import { deleteDocument } from "@/lib/rag/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  const document = await db.document.findFirst({
    where: { id, userId: userId! },
    select: {
      id: true,
      title: true,
      filename: true,
      mimeType: true,
      fileSize: true,
      status: true,
      error: true,
      chunkCount: true,
      embeddingProvider: true,
      embeddingDim: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({
    document: {
      ...document,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  const removed = await deleteDocument(userId!, id);
  if (!removed) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, documentId: id });
}
