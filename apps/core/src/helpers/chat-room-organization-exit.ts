import type { Prisma } from "@sokosumi/database";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { publishChatMembershipRevoked } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { recordChannelMembershipStatus } from "@/routes/v1/chats/rooms/membership-status";

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

  for (const membership of memberships) {
    const room = membership.room;
    revokedRoomIds.push(room.id);

    if (room.kind === "channel") {
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

  const remainingRows = await tx.chatRoomUserMember.groupBy({
    by: ["roomId"],
    where: { roomId: { in: revokedRoomIds } },
    _count: { _all: true },
  });
  const roomsWithHumans = new Set(remainingRows.map((row) => row.roomId));

  for (const roomId of revokedRoomIds) {
    if (roomsWithHumans.has(roomId)) {
      continue;
    }
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
        data: { archivedAt: new Date() },
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

  const outcomes = await Promise.allSettled([
    Promise.all(
      statusMessages.map((message) =>
        publishChatRoomMessageRealtime(message, "create"),
      ),
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
 * Full organization-exit chat cleanup in its own transaction, then realtime.
 * Use from Better Auth `beforeRemoveMember` (member row still present).
 * Voluntary leave has no BA hook — durable hard-leave is the member-delete
 * DB trigger (`chat_room_hard_leave_on_organization_member_delete`).
 */
export async function revokeChatRoomMembershipsOnOrganizationExit(
  userId: string,
  organizationId: string,
): Promise<OrganizationExitChatRevocationResult> {
  const result = await prisma.$transaction((tx) =>
    applyOrganizationExitChatRevocation(tx, userId, organizationId),
  );
  await publishOrganizationExitChatRevocation(userId, result);
  return result;
}
