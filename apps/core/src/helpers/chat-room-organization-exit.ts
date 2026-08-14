import type { Prisma } from "@sokosumi/database";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { publishChatMembershipRevoked } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { recordChannelMembershipStatus } from "@/routes/v1/chats/rooms/membership-status";
import { CHAT_ROOM_INVITATION_STATUS } from "@/schemas/chat-room-invitation.schema";

type TransactionClient = Prisma.TransactionClient;

type StatusMessage = Awaited<
  ReturnType<typeof recordChannelMembershipStatus>
>[number];

export interface OrganizationExitChatRevocationResult {
  /** Rooms the user lost membership on (for Ably membership revoke). */
  revokedRoomIds: string[];
  /** Channel timeline "left" rows; publish after commit. */
  statusMessages: StatusMessage[];
}

/**
 * Organization exit (chat): hard-leave every room owned by the organization.
 *
 * Deletes the user's room memberships and read states for that org's rooms
 * (channels and org directs, including external). Records channel "left"
 * status messages. Soft-archives channels left with zero humans. Hard-deletes
 * directs left with zero humans (soft-archive would keep `directKey` and block
 * create-or-get; product archive API already forbids archiving directs).
 * Revokes pending guest invitations and live invite links on rooms left with
 * zero humans (parity with the member-delete DB trigger).
 *
 * Does not publish realtime — call {@link publishOrganizationExitChatRevocation}
 * after the surrounding transaction commits.
 */
export async function applyOrganizationExitChatRevocation(
  tx: TransactionClient,
  userId: string,
  organizationId: string,
): Promise<OrganizationExitChatRevocationResult> {
  const memberships = await tx.chatRoomUserMember.findMany({
    where: {
      userId,
      room: { organizationId },
    },
    select: {
      roomId: true,
      room: {
        select: {
          id: true,
          kind: true,
          archivedAt: true,
        },
      },
    },
  });

  if (memberships.length === 0) {
    return { revokedRoomIds: [], statusMessages: [] };
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const actorName = user?.name?.trim() || "Someone";

  const revokedRoomIds: string[] = [];
  const statusMessages: StatusMessage[] = [];
  const roomById = new Map(
    memberships.map((membership) => [membership.room.id, membership.room]),
  );
  const channelRoomIds: string[] = [];

  for (const membership of memberships) {
    const room = membership.room;
    revokedRoomIds.push(room.id);

    if (room.kind === "channel") {
      channelRoomIds.push(room.id);
      const created = await recordChannelMembershipStatus(tx, {
        roomId: room.id,
        roomKind: room.kind,
        changes: [
          {
            action: "left",
            subject: {
              type: "user",
              id: userId,
              name: actorName,
            },
          },
        ],
      });
      statusMessages.push(...created);
    }
  }

  await tx.chatRoomUserMember.deleteMany({
    where: {
      userId,
      roomId: { in: revokedRoomIds },
    },
  });
  await tx.chatRoomReadState.deleteMany({
    where: {
      userId,
      roomId: { in: revokedRoomIds },
    },
  });

  // Raw SQL status insert does not touch room.updatedAt; bump so room lists
  // ordered by activity see the leave. Archive path also sets updatedAt below.
  if (channelRoomIds.length > 0) {
    await tx.chatRoom.updateMany({
      where: { id: { in: channelRoomIds } },
      data: { updatedAt: new Date() },
    });
  }

  const remainingRows = await tx.chatRoomUserMember.groupBy({
    by: ["roomId"],
    where: { roomId: { in: revokedRoomIds } },
    _count: { _all: true },
  });
  const roomsWithHumans = new Set(remainingRows.map((row) => row.roomId));
  const emptyRoomIds = revokedRoomIds.filter(
    (roomId) => !roomsWithHumans.has(roomId),
  );

  if (emptyRoomIds.length > 0) {
    // Parity with DB trigger: no hanging pending guest invites on rooms that
    // force-archive (or hard-delete) with zero humans.
    await tx.chatRoomGuestInvitation.updateMany({
      where: {
        roomId: { in: emptyRoomIds },
        status: CHAT_ROOM_INVITATION_STATUS.PENDING,
      },
      data: { status: CHAT_ROOM_INVITATION_STATUS.REVOKED },
    });
    await tx.chatRoomGuestInviteLink.updateMany({
      where: {
        roomId: { in: emptyRoomIds },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  for (const roomId of emptyRoomIds) {
    const room = roomById.get(roomId);
    if (!room) {
      continue;
    }

    if (room.kind === "direct") {
      // Empty direct: hard-delete. Soft-archive keeps directKey (CHECK + unique
      // index) and create-or-get cannot reopen a new DM for the same pair.
      await tx.chatRoom.delete({ where: { id: roomId } });
      continue;
    }

    if (room.kind === "channel" && room.archivedAt === null) {
      await tx.chatRoom.updateMany({
        where: { id: roomId, archivedAt: null },
        data: { archivedAt: new Date(), updatedAt: new Date() },
      });
    }
  }

  return { revokedRoomIds, statusMessages };
}

/** Best-effort Ably fan-out after organization-exit chat revocation commits. */
export async function publishOrganizationExitChatRevocation(
  userId: string,
  result: OrganizationExitChatRevocationResult,
): Promise<void> {
  const { revokedRoomIds, statusMessages } = result;
  if (revokedRoomIds.length === 0 && statusMessages.length === 0) {
    return;
  }

  // Each publish is a separate settled entry so one failure does not hide others.
  const outcomes = await Promise.allSettled([
    ...statusMessages.map((message) =>
      publishChatRoomMessageRealtime(message, "create"),
    ),
    ...revokedRoomIds.map((roomId) =>
      publishChatMembershipRevoked({
        userId,
        roomId,
        reason: "left",
      }),
    ),
  ]);

  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      console.error(
        "Failed to publish organization-exit chat side effect",
        outcome.reason,
      );
    }
  }
}

/**
 * Snapshot org room memberships for post-commit Ably without mutating chat.
 * Pass the returned IDs to {@link publishOrganizationExitChatRevocation} after
 * the Member row is deleted (DB trigger performs durable hard-leave).
 *
 * Better Auth before/after hooks cannot share return values; callers should
 * hand the array through the same `member` object reference BA passes to both
 * hooks (see auth organizationHooks).
 */
export async function listOrganizationExitChatRoomIdsForAbly(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  const rows = await prisma.chatRoomUserMember.findMany({
    where: {
      userId,
      room: { organizationId },
    },
    select: { roomId: true },
  });
  return rows.map((row) => row.roomId);
}
