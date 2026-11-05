import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";

import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import {
  type ChatMentionRoomShape,
  emitChatMentionNotifications,
} from "@/helpers/chat-mention-notifications";
import { emitChatRoomMessageNotifications } from "@/helpers/chat-room-message-created-effects";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";
import { resolveMentionedUserIds } from "@/routes/v1/chats/rooms/helpers";

/**
 * Human @mentions on a message a Coworker or a Soko Bot wrote.
 *
 * The human message route resolves, persists and notifies inline, because it
 * holds the room and the author already. An assistant writes on six other
 * paths, most of which fill a placeholder after a stream has finished, so the
 * same three steps live here and each path calls them once the text is final.
 */

interface HumanMentionTransaction {
  chatRoomUserMember: Pick<
    Prisma.TransactionClient["chatRoomUserMember"],
    "findMany"
  >;
  chatRoomUserMention: Pick<
    Prisma.TransactionClient["chatRoomUserMention"],
    "createMany"
  >;
}

interface PersistChatHumanMentionsParams {
  messageId: string;
  roomId: string;
  content: string;
  /** See `resolveMentionedUserIds`; defaults to expanding `@all`. */
  expandAll?: boolean;
}

/**
 * Write the mention rows for the room members the body names, inside the
 * transaction that wrote the body, and answer who they are.
 *
 * Nobody is excluded: an assistant has no user id to leave out, and a bot that
 * names its own owner is handing work back, which is the mention that matters
 * most. `skipDuplicates` keeps a retried fill from writing a row twice.
 */
export async function persistChatHumanMentions(
  tx: HumanMentionTransaction,
  params: PersistChatHumanMentionsParams,
): Promise<string[]> {
  const members = await tx.chatRoomUserMember.findMany({
    where: { roomId: params.roomId },
    select: { userId: true, user: { select: { name: true } } },
  });
  const mentionedUserIds = resolveMentionedUserIds({
    content: params.content,
    roomUsers: members.map((member) => ({
      id: member.userId,
      name: member.user.name,
    })),
    expandAll: params.expandAll,
  });

  if (mentionedUserIds.length === 0) {
    return [];
  }

  await tx.chatRoomUserMention.createMany({
    data: mentionedUserIds.map((userId) => ({
      messageId: params.messageId,
      userId,
    })),
    skipDuplicates: true,
  });

  return mentionedUserIds;
}

interface ChatMentionRoomShapeParams {
  kind: string;
  memberUserIds: readonly string[];
  nonHumanMemberCount: number;
}

/**
 * How a mention names the room it landed in.
 *
 * A pair is what the direct-message row calls a pair, asked through the same
 * function so a mention and a message in one room cannot disagree. That rule
 * counts humans only, because a coworker and a bot are not sent a
 * direct-message row. A name has to count them: a room of two humans and a
 * bot is named after both the other two on the reader's own screen, so it has
 * a name worth saying and is a group here, not a pair.
 */
export function chatMentionRoomShape(
  room: ChatMentionRoomShapeParams,
): ChatMentionRoomShape {
  if (room.kind !== "direct") {
    return "channel";
  }
  const isPair =
    shouldEmitChatDirectMessageNotifications({
      kind: room.kind,
      memberUserIds: room.memberUserIds,
    }) && room.nonHumanMemberCount === 0;

  return isPair ? "pair" : "group";
}

interface EmitChatMessageNotificationsParams {
  throwOnError?: boolean;
  messageId: string;
  mentionedUserIds: readonly string[];
}

/**
 * Emit the CHAT mention notifications for an assistant's message, after the
 * transaction that wrote it committed.
 *
 * Reads the message back rather than taking the room and the author from the
 * caller: the six paths hold different slices of the room, and one read here
 * is cheaper than widening six loaders. The author is the Coworker or the
 * Soko Bot under its own name, never the person who owns it: the fan-out
 * drops the author from the recipients, and the owner is who a bot most often
 * hands work back to.
 *
 * Reports rather than rejects, for the reason the emitter beside it does.
 */
export async function emitChatHumanMentionNotifications(
  params: EmitChatMessageNotificationsParams,
): Promise<void> {
  if (params.mentionedUserIds.length === 0) {
    return;
  }

  await emitStoredMessageNotifications(params, false);
}

/**
 * Deliver a completed assistant Direct and its explicit human mentions.
 * Channel and group replies also reach readers who opted into every message.
 */
export async function emitChatMessageNotifications(
  params: EmitChatMessageNotificationsParams,
): Promise<void> {
  await emitStoredMessageNotifications(params, true);
}

async function emitStoredMessageNotifications(
  params: EmitChatMessageNotificationsParams,
  includeMessage: boolean,
): Promise<void> {
  try {
    const message = await prisma.chatRoomMessage.findUnique({
      where: { id: params.messageId },
      select: {
        content: true,
        deletedAt: true,
        parentMessageId: true,
        senderCoworker: { select: { name: true } },
        senderSokoBot: { select: { name: true } },
        room: {
          select: {
            id: true,
            name: true,
            groupName: true,
            organizationId: true,
            kind: true,
            userMembers: { select: { userId: true } },
            _count: {
              select: { coworkerMembers: true, sokoBotMembers: true },
            },
          },
        },
      },
    });
    if (!message || message.deletedAt) {
      return;
    }
    const memberUserIds = message.room.userMembers.map(
      (member) => member.userId,
    );
    const authorName = message.senderSokoBot
      ? sokoBotDisplayName(message.senderSokoBot)
      : (message.senderCoworker?.name ?? "Someone");
    const common = {
      roomId: message.room.id,
      roomName: message.room.groupName ?? message.room.name,
      organizationId: message.room.organizationId,
      messageId: params.messageId,
      content: message.content,
      authorUserId: null,
      authorName,
      ...(params.throwOnError ? { throwOnError: true } : {}),
    };
    const pending: Promise<void>[] = [];
    if (includeMessage) {
      if (
        shouldEmitChatDirectMessageNotifications({
          kind: message.room.kind,
          memberUserIds,
        })
      ) {
        pending.push(
          emitChatDirectMessageNotifications({
            ...common,
            parentMessageId: message.parentMessageId,
            recipientUserIds: memberUserIds,
            mentionedUserIds: params.mentionedUserIds,
          }),
        );
      } else {
        pending.push(
          emitChatRoomMessageNotifications(
            {
              ...common,
              roomKind: message.room.kind,
              parentMessageId: message.parentMessageId,
              mentionedUserIds: params.mentionedUserIds,
            },
            memberUserIds,
          ),
        );
      }
    }
    if (params.mentionedUserIds.length > 0) {
      pending.push(
        emitChatMentionNotifications({
          ...common,
          roomShape: chatMentionRoomShape({
            kind: message.room.kind,
            memberUserIds,
            nonHumanMemberCount:
              message.room._count.coworkerMembers +
              message.room._count.sokoBotMembers,
          }),
          mentionedUserIds: params.mentionedUserIds,
        }),
      );
    }
    await Promise.all(pending);
  } catch (error) {
    if (params.throwOnError) throw error;
    Sentry.captureException(error, {
      tags: {
        context: includeMessage
          ? "chat_message_notifications"
          : "chat_mention_notifications",
      },
      extra: {
        messageId: params.messageId,
        mentionedCount: params.mentionedUserIds.length,
      },
    });
  }
}
