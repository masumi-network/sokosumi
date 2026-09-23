import {
  canQuoteIntoRoom,
  isSelfJoinableChannelDiscoverability,
} from "@sokosumi/utils";

import {
  type PendingRoomQuote,
  pendingQuoteFromMessage,
} from "@/app/chat/components/room-helpers";
import { isRoomStatusMessage } from "@/app/chat/utils/room-status-message";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import type { ChatRoomMessageLink } from "@/lib/utils/notification-href";

type QuoteRoom = Pick<
  ChatRoom,
  "id" | "kind" | "discoverability" | "organizationId" | "userMembers"
>;

interface ResolveMessageLinkQuoteOptions {
  link: ChatRoomMessageLink;
  targetRoom: QuoteRoom;
  /** Membership-visible rooms, to read the source room's roster from. */
  rooms: ReadonlyArray<QuoteRoom>;
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
        sourceReaderUserIds(sourceRoom, targetRoom),
      )
    ) {
      return null;
    }
  }

  const message = await loadMessage(link.roomId, link.messageId);
  if (!message || message.deletedAt != null || isRoomStatusMessage(message)) {
    return null;
  }

  return {
    ...pendingQuoteFromMessage(message),
    ...(isCrossRoom ? { roomId: link.roomId } : {}),
  };
}

/**
 * The source roster, plus the target readers who can join a public or external
 * source Channel on their own. Core checks organization membership; here a
 * non-guest member of a room in the same organization stands in for it.
 */
function sourceReaderUserIds(
  sourceRoom: QuoteRoom,
  targetRoom: QuoteRoom,
): string[] {
  const readers = sourceRoom.userMembers.map((member) => member.id);
  if (
    sourceRoom.kind !== "channel" ||
    !sourceRoom.organizationId ||
    sourceRoom.organizationId !== targetRoom.organizationId ||
    !isSelfJoinableChannelDiscoverability(sourceRoom.discoverability)
  ) {
    return readers;
  }
  return [
    ...readers,
    ...targetRoom.userMembers
      .filter((member) => member.access !== "guest")
      .map((member) => member.id),
  ];
}
