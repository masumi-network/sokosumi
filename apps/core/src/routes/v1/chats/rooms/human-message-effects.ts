import { waitUntil } from "@vercel/functions";
import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import { emitChatRoomMessageCreatedEffects } from "@/helpers/chat-room-message-created-effects";
import { enqueueChatMessageSignal } from "@/services/chat-message-signals.service";
import { scheduleChatRoomMessageUnfurls } from "@/services/chat-room-message-unfurl.service";

export interface HumanRoomMessageEffectsParams {
  message: {
    id: string;
    parentMessageId: string | null;
    content: string;
    senderUser: { name: string | null } | null;
  };
  room: {
    id: string;
    name: string;
    organizationId: string | null;
    kind: string;
    /** Read inside the write transaction: the roster the message was posted against. */
    memberUserIds: string[];
  };
  authorUserId: string;
  mentionedUserIds: string[];
}

/**
 * What every new message a person posts sets off after its write, besides
 * mentions: the Direct notification, unread and reader effects, link
 * unfurls and the catch-up signal. Starts no Coworker or Soko Bot.
 */
export function emitHumanRoomMessageEffects({
  message,
  room,
  authorUserId,
  mentionedUserIds,
}: HumanRoomMessageEffectsParams): void {
  const authorName = message.senderUser?.name ?? "Someone";

  // The same rule the direct-message row is written by, so a mention and
  // a message in the same room cannot disagree about whether that room is
  // a pair.
  if (
    shouldEmitChatDirectMessageNotifications({
      kind: room.kind,
      memberUserIds: room.memberUserIds,
    })
  ) {
    const recipientUserIds = room.memberUserIds.filter(
      (userId) => userId !== authorUserId,
    );
    if (recipientUserIds.length > 0) {
      waitUntil(
        emitChatDirectMessageNotifications({
          roomId: room.id,
          roomName: room.name,
          organizationId: room.organizationId,
          messageId: message.id,
          parentMessageId: message.parentMessageId,
          content: message.content,
          authorUserId,
          authorName,
          recipientUserIds,
          mentionedUserIds,
        }),
      );
    }
  }

  waitUntil(
    emitChatRoomMessageCreatedEffects({
      roomId: room.id,
      roomName: room.name,
      roomKind: room.kind,
      organizationId: room.organizationId,
      messageId: message.id,
      parentMessageId: message.parentMessageId,
      content: message.content,
      authorUserId,
      authorName,
      memberUserIds: room.memberUserIds,
      mentionedUserIds,
    }),
  );

  waitUntil(scheduleChatRoomMessageUnfurls(message.id));
  // Jev reads it once the room goes quiet; never in front of the send.
  waitUntil(enqueueChatMessageSignal(message.id));
}
