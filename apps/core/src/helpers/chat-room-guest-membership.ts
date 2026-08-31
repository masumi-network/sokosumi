import type { Prisma } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { recordChannelMembershipStatus } from "@/routes/v1/chats/rooms/membership-status";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";

export interface JoinExternalChannelAsGuestResult {
  userId: string;
  roomId: string;
  roomName: string;
  access: typeof CHAT_ROOM_ACCESS.GUEST;
  outcome: "joined" | "already_guest" | "aborted";
}

interface JoinExternalChannelAsGuestArgs {
  userId: string;
  roomId: string;
  /** When set, the room must belong to this org (404 on mismatch). */
  organizationId?: string;
  /** Override 400 copy when the room exists but is not a live External channel. */
  roomUnavailableMessage?: string;
  /**
   * Runs after eligibility and before membership create. `"abort"` skips
   * create (invite-link consume failed). Not called when already a guest.
   */
  beforeCreate?: () => Promise<"continue" | "abort">;
}

/**
 * Create-only guest membership on a live External channel. Same invariants for
 * admin add, invite-link claim, and email invite accept: no host-org Member, no
 * demotion of an existing room member, idempotent when already a guest. Caller
 * publishes realtime after the transaction commits.
 */
export async function joinExternalChannelAsGuest(
  tx: Prisma.TransactionClient,
  args: JoinExternalChannelAsGuestArgs,
): Promise<{
  result: JoinExternalChannelAsGuestResult;
  statusMessages: Awaited<ReturnType<typeof recordChannelMembershipStatus>>;
}> {
  const unavailableMessage =
    args.roomUnavailableMessage ?? "Room is not available for guests.";

  const user = await tx.user.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true },
  });
  if (!user) {
    throw notFound("User not found");
  }

  await tx.$queryRaw`
    SELECT "id" FROM "chat_room"
    WHERE "id" = ${args.roomId}::uuid
    FOR UPDATE
  `;

  const room = await tx.chatRoom.findUnique({
    where: { id: args.roomId },
    select: {
      id: true,
      name: true,
      kind: true,
      discoverability: true,
      archivedAt: true,
      organizationId: true,
    },
  });

  if (!room) {
    if (args.organizationId) {
      throw notFound("Room not found");
    }
    throw badRequest(unavailableMessage);
  }

  if (args.organizationId && room.organizationId !== args.organizationId) {
    throw notFound("Room not found");
  }

  if (
    room.archivedAt !== null ||
    room.kind !== "channel" ||
    room.discoverability !== "external" ||
    !room.organizationId
  ) {
    throw badRequest(unavailableMessage);
  }

  const organizationId = room.organizationId;

  const existingMembership = await tx.chatRoomUserMember.findUnique({
    where: {
      roomId_userId: {
        roomId: room.id,
        userId: user.id,
      },
    },
    select: { access: true },
  });

  if (existingMembership?.access === CHAT_ROOM_ACCESS.GUEST) {
    return {
      result: {
        userId: user.id,
        roomId: room.id,
        roomName: room.name,
        access: CHAT_ROOM_ACCESS.GUEST,
        outcome: "already_guest",
      },
      statusMessages: [],
    };
  }

  if (existingMembership) {
    throw badRequest("Already a member of this room.");
  }

  const hostMember = await tx.member.findUnique({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId,
      },
    },
    select: { id: true },
  });
  if (hostMember) {
    throw badRequest(
      "User is already an organization member; they can join the channel directly.",
    );
  }

  if (args.beforeCreate) {
    const gate = await args.beforeCreate();
    if (gate === "abort") {
      return {
        result: {
          userId: user.id,
          roomId: room.id,
          roomName: room.name,
          access: CHAT_ROOM_ACCESS.GUEST,
          outcome: "aborted",
        },
        statusMessages: [],
      };
    }
  }

  try {
    await tx.$executeRaw`SAVEPOINT external_channel_guest_create`;
    await tx.chatRoomUserMember.create({
      data: {
        roomId: room.id,
        userId: user.id,
        access: CHAT_ROOM_ACCESS.GUEST,
      },
    });
    await tx.$executeRaw`RELEASE SAVEPOINT external_channel_guest_create`;
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }
    // Unique violation aborts the interactive txn unless we roll back to a
    // savepoint first (Postgres). Re-read after restoring so callers can keep
    // using `tx`.
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT external_channel_guest_create`;
    const raced = await tx.chatRoomUserMember.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: user.id,
        },
      },
      select: { access: true },
    });
    if (raced?.access === CHAT_ROOM_ACCESS.GUEST) {
      return {
        result: {
          userId: user.id,
          roomId: room.id,
          roomName: room.name,
          access: CHAT_ROOM_ACCESS.GUEST,
          outcome: "already_guest",
        },
        statusMessages: [],
      };
    }
    throw badRequest("Already a member of this room.");
  }

  await tx.chatRoomReadState.createMany({
    data: [{ roomId: room.id, userId: user.id }],
    skipDuplicates: true,
  });

  const actorName = user.name?.trim() || "Someone";
  const statusMessages = await recordChannelMembershipStatus(tx, {
    roomId: room.id,
    roomKind: room.kind,
    changes: [
      {
        action: "joined",
        subject: {
          type: "user",
          id: user.id,
          name: actorName,
        },
      },
    ],
  });

  return {
    result: {
      userId: user.id,
      roomId: room.id,
      roomName: room.name,
      access: CHAT_ROOM_ACCESS.GUEST,
      outcome: "joined",
    },
    statusMessages,
  };
}
