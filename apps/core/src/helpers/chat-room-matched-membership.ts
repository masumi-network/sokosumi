import type { Prisma } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { recordChannelMembershipStatus } from "@/routes/v1/chats/rooms/membership-status";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";

export interface EnsureMatchedChannelParticipantResult {
  userId: string;
  roomId: string;
  roomName: string;
  access: typeof CHAT_ROOM_ACCESS.MEMBER;
  outcome: "joined" | "already_member";
}

interface EnsureMatchedChannelParticipantArgs {
  userId: string;
  roomId: string;
}

/**
 * Create-only member membership on a live org-less matched channel. Idempotent
 * when already a member. Caller publishes realtime after the transaction commits.
 */
export async function ensureMatchedChannelParticipant(
  tx: Prisma.TransactionClient,
  args: EnsureMatchedChannelParticipantArgs,
): Promise<{
  result: EnsureMatchedChannelParticipantResult;
  statusMessages: Awaited<ReturnType<typeof recordChannelMembershipStatus>>;
}> {
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

  if (
    !room ||
    room.archivedAt !== null ||
    room.kind !== "channel" ||
    room.discoverability !== "matched" ||
    room.organizationId !== null
  ) {
    throw badRequest("Room is not a live matched channel.");
  }

  const existingMembership = await tx.chatRoomUserMember.findUnique({
    where: {
      roomId_userId: {
        roomId: room.id,
        userId: user.id,
      },
    },
    select: { access: true },
  });

  if (existingMembership?.access === CHAT_ROOM_ACCESS.MEMBER) {
    return {
      result: {
        userId: user.id,
        roomId: room.id,
        roomName: room.name,
        access: CHAT_ROOM_ACCESS.MEMBER,
        outcome: "already_member",
      },
      statusMessages: [],
    };
  }

  if (existingMembership) {
    throw badRequest("Already a participant of this room.");
  }

  try {
    await tx.chatRoomUserMember.create({
      data: {
        roomId: room.id,
        userId: user.id,
        access: CHAT_ROOM_ACCESS.MEMBER,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }
    const raced = await tx.chatRoomUserMember.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: user.id,
        },
      },
      select: { access: true },
    });
    if (raced?.access === CHAT_ROOM_ACCESS.MEMBER) {
      return {
        result: {
          userId: user.id,
          roomId: room.id,
          roomName: room.name,
          access: CHAT_ROOM_ACCESS.MEMBER,
          outcome: "already_member",
        },
        statusMessages: [],
      };
    }
    throw badRequest("Already a participant of this room.");
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
      access: CHAT_ROOM_ACCESS.MEMBER,
      outcome: "joined",
    },
    statusMessages,
  };
}
