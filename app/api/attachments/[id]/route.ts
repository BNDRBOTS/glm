/**
 * GET /api/attachments/[id]
 * ---------------------------------------------------------------------
 * Download an uploaded attachment. Access: requester must own or be a
 * group member of the chat the attachment belongs to — the same
 * boundary as reading the chat itself.
 *
 * DOCUMENT RECALL: attachments were previously write-only (stored to
 * disk + DB row, but no route could ever read them back). This route
 * closes that gap. If the DB row exists but the file is missing from
 * storage (e.g. pre-volume deploys lost the disk), we surface an
 * explicit 410 Gone with the metadata instead of pretending the
 * document never existed.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/require-user";
import { readAttachment } from "@/lib/storage/attachments";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;
  const { id } = await params;

  const attachment = await db.attachment.findFirst({
    where: {
      id,
      chat: {
        OR: [
          { ownerId: userId! },
          { group: { members: { some: { userId: userId! } } } },
        ],
      },
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      storage: true,
      storageKey: true,
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  if (attachment.storage !== "LOCAL") {
    return NextResponse.json(
      { error: `Storage backend "${attachment.storage}" is not readable on this deployment.` },
      { status: 501 }
    );
  }

  const data = await readAttachment(attachment.storageKey);
  if (!data) {
    return NextResponse.json(
      {
        error: "Attachment file is missing from storage.",
        detail:
          "The database record exists but the file is gone — likely stored before ATTACHMENTS_DIR pointed at durable storage.",
        attachment: {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
        },
      },
      { status: 410 }
    );
  }

  // Sanitize for the Content-Disposition header (filename is already
  // sanitized at store time; belt and braces).
  const safeName = attachment.filename.replace(/[^\w.\-]+/g, "_");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
