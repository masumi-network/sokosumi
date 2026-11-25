"use client";

import type { ChatFeedItem } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { messageSender } from "@/app/chat/components/room-helpers";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

/**
 * Where a Feed message was said: its room, and "In a thread" for a reply.
 * Opens the message in its room, in its Thread if a reply.
 *
 * A Direct's own name is not one a person reads, so a Direct is named the
 * way the sidebar names it when the reader's live rooms hold it, and after
 * the sender otherwise.
 */
export function FeedSourceLine({
  item,
  currentUserId,
}: {
  item: ChatFeedItem;
  currentUserId: string;
}) {
  const t = useTranslations("App.Channels.Feed");
  const roomDisplayName = useRoomDisplayName();
  const liveRoom = useLiveChatRooms()?.find((room) => room.id === item.room.id);
  const roomName =
    item.room.kind === "channel"
      ? `#${item.room.name}`
      : liveRoom
        ? roomDisplayName(liveRoom, currentUserId)
        : messageSender(item.message).name;

  return (
    <Link
      href={chatRoomMessageHref(item.room.id, item.message.id)}
      className="text-muted-foreground hover:text-foreground w-fit max-w-full truncate rounded-sm px-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="feed-source-line"
    >
      {[roomName, item.message.parentMessageId ? t("inThread") : null]
        .filter(Boolean)
        .join(" · ")}
    </Link>
  );
}
