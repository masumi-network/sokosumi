"use client";

import type {
  ChatFeedItem,
  ChatRoomCoworkerParticipant,
} from "@sokosumi/core-client";
import { ChatMessageRow } from "@/app/chat/components/room-message-row";

import { FeedSourceLine } from "./feed-source-line";

/** The Feed reads no room roster; mentions of coworkers show as written. */
const NO_COWORKERS = new Map<string, ChatRoomCoworkerParticipant>();

/**
 * One Feed message: where it was said, then the message as its room draws
 * it. Read only in this slice: no Thread or quote buttons, and no reply.
 */
export function FeedItemRow({
  item,
  currentUserId,
}: {
  item: ChatFeedItem;
  currentUserId: string;
}) {
  return (
    <li className="flex flex-col gap-1">
      <FeedSourceLine item={item} currentUserId={currentUserId} />
      <ChatMessageRow
        message={item.message}
        coworkersById={NO_COWORKERS}
        coworkersBySlug={NO_COWORKERS}
        currentUserId={currentUserId}
        showThreadButton={false}
        showQuoteButton={false}
      />
    </li>
  );
}
