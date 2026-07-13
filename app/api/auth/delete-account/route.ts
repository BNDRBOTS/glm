/**
 * POST /api/auth/delete-account
 * ---------------------------------------------------------------------
 * Body: { confirmEmail }
 *
 * Requires an authenticated session. The confirmEmail field must
 * match the user's actual email — a defense-in-depth check so a
 * stray click or a stolen cookie alone can't trigger deletion.
 *
 * Deletion is IRREVERSIBLE. Prisma's onDelete: Cascade on every
 * relation (chats, messages, integrations, memoryLogs, usageLogs,
 * exports, skills, groupMemberships, passwordResetTokens) means a
 * single user.delete() wipes everything. Group memberships are also
 * cascade-deleted, but the GROUP itself survives (other members keep
 * their shared chats).
 *
 * If the user is the OWNER of any groups, we transfer ownership to
 * the longest-tenured remaining member before deletion. If no other
 * members exist, the group (and its chats) gets deleted too via the
 * GroupMember cascade.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/nextauth";
import { logAudit } from "@/lib/audit";
import { deleteAttachmentFiles } from "@/lib/storage/attachments";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in to delete your account." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { confirmEmail?: string };
  const confirmEmail = body.confirmEmail?.toLowerCase().trim();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
  }

  if (confirmEmail !== user.email) {
    return NextResponse.json(
      { ok: false, error: "Email confirmation does not match." },
      { status: 400 }
    );
  }

  // Before deletion: for each group this user owns, transfer ownership
  // to the next longest-tenured member (or let it cascade-delete if
  // they're the only member).
  const ownedGroups = await db.group.findMany({
    where: { members: { some: { userId, role: "OWNER" } } },
    select: {
      id: true,
      members: {
        where: { userId: { not: userId } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { userId: true },
      },
    },
  });

  const soleOwnedGroupIds: string[] = [];
  for (const g of ownedGroups) {
    if (g.members.length > 0) {
      await db.groupMember.update({
        where: { groupId_userId: { groupId: g.id, userId: g.members[0].userId } },
        data: { role: "OWNER" },
      });
    } else {
      // No other members. Deleting the user only cascades the
      // GroupMember rows — the Group row itself would survive as an
      // orphan (memberless, unreachable by any query that filters on
      // membership). Track it for explicit deletion below.
      soleOwnedGroupIds.push(g.id);
    }
  }

  // Collect attachment files for chats this user owns BEFORE the
  // cascade removes the rows — otherwise the files leak on disk with
  // nothing left pointing at them.
  const attachmentRows = await db.attachment.findMany({
    where: { chat: { ownerId: userId } },
    select: { storage: true, storageKey: true },
  });

  // Log BEFORE deletion so we have the userId in the audit trail.
  await logAudit({
    userId,
    source: "auth",
    level: "warn",
    event: "user.account_deleted",
    payload: {
      email: user.email,
      ownedGroupsTransferred: ownedGroups.length - soleOwnedGroupIds.length,
      groupsDeleted: soleOwnedGroupIds.length,
      attachmentFiles: attachmentRows.length,
    },
  });

  await db.user.delete({ where: { id: userId } });

  // Remove groups that are now memberless. Re-check the count so a
  // concurrently-added member keeps the group alive.
  for (const groupId of soleOwnedGroupIds) {
    const remaining = await db.groupMember.count({ where: { groupId } });
    if (remaining === 0) {
      await db.group.delete({ where: { id: groupId } }).catch(() => {});
    }
  }

  // Best-effort disk cleanup — DB rows are already gone via cascade.
  await deleteAttachmentFiles(attachmentRows);

  return NextResponse.json({ ok: true });
}
