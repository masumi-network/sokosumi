import { z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { markLookedThreadReplyRowsRead } from "@/helpers/chat-thread-reply-notifications";
import { notFound } from "@/helpers/error";
import { cancelNotificationEmails } from "@/helpers/notification-email-dispatch";
import { publishClearedNotifications } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";
import type { ChatRoomThread } from "@/schemas/chat-room.schema";
import { chatRoomThreadSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserAccess } from "../../../../helpers";
import {
  getChatRoomThread,
  setChatRoomThreadMuted,
} from "../../../../room-unread";

export const chatRoomThreadMuteParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  parentMessageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "parentMessageId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
});

/**
 * Mute or unmute one thread for one user, then read it back as they now see
 * it. Both directions share this: only the flag differs.
 */
export async function setThreadMuteAndReadBack(params: {
  roomId: string;
  userId: string;
  parentMessageId: string;
  muted: boolean;
}): Promise<ChatRoomThread> {
  const room = await requireChatRoomUserAccess(
    params.roomId,
    params.userId,
    prisma,
  );
  const state = await setChatRoomThreadMuted(
    room.id,
    params.userId,
    params.parentMessageId,
    params.muted,
    prisma,
  );
  if (!state) {
    throw notFound("Thread not found");
  }

  // Muting Looks the Thread, and so can unmuting, so both clear what that
  // Look covers (SOK-1217).
  const clearedRows = await markLookedThreadReplyRowsRead(
    room.id,
    params.userId,
    prisma,
  );
  waitUntil(publishClearedNotifications(clearedRows.map((row) => row.id)));
  waitUntil(cancelNotificationEmails(clearedRows));

  const thread = await getChatRoomThread(
    room.id,
    params.userId,
    params.parentMessageId,
    prisma,
  );
  if (!thread) {
    throw notFound("Thread not found");
  }

  return chatRoomThreadSchema.parse(thread);
}
