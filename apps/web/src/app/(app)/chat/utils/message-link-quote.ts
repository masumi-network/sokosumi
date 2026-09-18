import { canQuoteIntoRoom } from "@sokosumi/utils";

import {
  type PendingRoomQuote,
  pendingQuoteFromMessage,
} from "@/app/chat/components/room-helpers";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import type { ChatRoomMessageLink } from "@/lib/utils/notification-href";

interface ResolveMessageLinkQuoteOptions {
  link: ChatRoomMessageLink;
  targetRoom: Pick<ChatRoom, "id" | "userMembers">;
  /** Membership-visible rooms, to read the source room's roster from. */
  rooms: ReadonlyArray<Pick<ChatRoom, "id" | "userMembers">>;
  /** False where the send path only takes same-room quotes (coworker stream). */
  allowCrossRoom: boolean;
  /** Resolves to null when the sender cannot read the message. */
  loadMessage: (
    roomId: string,
    messageId: string,
  ) => Promise<ChatRoomMessage | null>;
}

/**
 * The quote a pasted Message link may be sent as in `targetRoom`, or null when
 * it must stay a plain link. Core applies the same rule at send time; this only
 * decides whether the composer converts the paste.
 */
export async function resolveMessageLinkQuote({
  link,
  targetRoom,
  rooms,
  allowCrossRoom,
  loadMessage,
}: ResolveMessageLinkQuoteOptions): Promise<PendingRoomQuote | null> {
  const isCrossRoom = link.roomId !== targetRoom.id;
  if (isCrossRoom) {
    const sourceRoom = rooms.find((room) => room.id === link.roomId);
    if (
      !allowCrossRoom ||
      !sourceRoom ||
      !canQuoteIntoRoom(
        targetRoom.userMembers.map((member) => member.id),
        sourceRoom.userMembers.map((member) => member.id),
      )
    ) {
      return null;
    }
  }

  const message = await loadMessage(link.roomId, link.messageId);
  if (!message || message.deletedAt != null || message.membership != null) {
    return null;
  }

  return {
    ...pendingQuoteFromMessage(message),
    ...(isCrossRoom ? { roomId: link.roomId } : {}),
  };
}
