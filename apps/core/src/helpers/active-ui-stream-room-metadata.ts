import prisma from "@/lib/db/prisma";
import { getRedisClient } from "@/lib/redis";

import { ACTIVE_UI_STREAM_ID_METADATA_KEY } from "./active-ui-stream-metadata";

function roomActiveStreamRedisKey(roomId: string): string {
  return `sokosumi:room:${roomId}:${ACTIVE_UI_STREAM_ID_METADATA_KEY}`;
}

export async function readActiveUiStreamIdForRoom(
  roomId: string,
): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }
  const value = await redis.get(roomActiveStreamRedisKey(roomId));
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function clearActiveUiStreamIdForRoom(params: {
  roomId: string;
  userId: string;
}): Promise<void> {
  const { roomId, userId } = params;
  await prisma.$transaction(async (tx) => {
    const room = await tx.chatRoom.findFirst({
      where: {
        id: roomId,
        archivedAt: null,
        userMembers: {
          some: { userId },
        },
      },
      select: { id: true },
    });
    if (!room) {
      return;
    }
    const redis = getRedisClient();
    if (!redis) {
      return;
    }
    await redis.del(roomActiveStreamRedisKey(roomId));
  });
}

export async function setActiveUiStreamIdForRoom(params: {
  roomId: string;
  userId: string;
  streamId: string;
}): Promise<void> {
  const { roomId, userId, streamId } = params;
  await prisma.$transaction(async (tx) => {
    const room = await tx.chatRoom.findFirst({
      where: {
        id: roomId,
        archivedAt: null,
        userMembers: {
          some: { userId },
        },
      },
      select: { id: true },
    });
    if (!room) {
      throw new Error("Room not found");
    }
    const redis = getRedisClient();
    if (!redis) {
      throw new Error("Redis is required for resumable room UI streams");
    }
    await redis.set(roomActiveStreamRedisKey(roomId), streamId);
  });
}
