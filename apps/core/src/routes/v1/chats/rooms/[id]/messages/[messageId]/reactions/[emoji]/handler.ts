import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  type ChatRoomMessage,
  chatRoomMessageSchema,
} from "@/schemas/chat-room.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomCoworkerAccess,
  withChatRoomReplyCount,
} from "../../../../../helpers";
import { assertChatRoomContentMessage } from "../../../../../membership-status";
import { requireWritableChatRoom } from "../../../../../writable-chat-room";

export const chatRoomMessageReactionParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .openapi({
      param: { name: "emoji", in: "path" },
      description: "The emoji, percent-encoded.",
      example: "👍",
    }),
});

/** Who reacts: a person, or a Coworker reacting on Buzz. */
export type ChatRoomReactor = { userId: string } | { coworkerId: string };

export function reactorOf(authContext: AuthenticationContext): ChatRoomReactor {
  return isCoworkerAuthContext(authContext)
    ? { coworkerId: authContext.coworkerId }
    : { userId: requireUserAuthContext(authContext).userId };
}

/**
 * Set whether the current user (or Coworker) has one emoji Reaction on a
 * message, then read the message back as they now see it. Both directions
 * share this: only the flag differs. Repeating a call changes nothing and
 * publishes nothing, so a retry can never flip the Reaction back (ADR 0032).
 */
export async function setChatRoomMessageReaction(params: {
  roomId: string;
  messageId: string;
  reactor: ChatRoomReactor;
  emoji: string;
  reacted: boolean;
}): Promise<ChatRoomMessage> {
  const { roomId, messageId, reactor, emoji, reacted } = params;

  const { message, changed } = await prisma.$transaction(async (tx) => {
    if ("coworkerId" in reactor) {
      await requireChatRoomCoworkerAccess(roomId, reactor.coworkerId, tx);
    } else {
      await requireWritableChatRoom(roomId, reactor.userId, tx);
    }

    const target = await tx.chatRoomMessage.findFirst({
      where: { id: messageId, roomId },
      select: { deletedAt: true, metadata: true },
    });
    if (!target) {
      throw notFound("Message not found");
    }
    if (target.deletedAt != null) {
      throw badRequest("Cannot react to a deleted message");
    }
    assertChatRoomContentMessage(target.metadata);

    const { count } =
      "coworkerId" in reactor
        ? await setAgentReaction(tx, { messageId, emoji, ...reactor }, reacted)
        : reacted
          ? await tx.chatRoomReaction.createMany({
              data: { messageId, emoji, ...reactor },
              skipDuplicates: true,
            })
          : await tx.chatRoomReaction.deleteMany({
              where: { messageId, emoji, ...reactor },
            });

    return {
      changed: count > 0,
      message: await tx.chatRoomMessage.findUniqueOrThrow({
        where: { id: messageId },
        include: chatRoomMessageInclude,
      }),
    };
  });

  if (changed) {
    await publishChatRoomMessageRealtime(message, "reaction");
  }

  return chatRoomMessageSchema.parse(
    mapChatRoomMessage(
      await withChatRoomReplyCount(prisma, message),
      "userId" in reactor ? reactor.userId : undefined,
    ),
  );
}

function setAgentReaction(
  tx: Prisma.TransactionClient,
  where: { messageId: string; coworkerId: string; emoji: string },
  reacted: boolean,
) {
  return reacted
    ? tx.chatRoomAgentReaction.createMany({ data: where, skipDuplicates: true })
    : tx.chatRoomAgentReaction.deleteMany({ where });
}
