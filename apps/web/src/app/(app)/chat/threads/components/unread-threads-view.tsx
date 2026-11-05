"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { ChatUnreadViewHeader } from "@/app/chat/components/chat-unread-view-header";
import { EarlierThreadsList } from "@/components/chat/earlier-threads-list";
import { resolveUnreadThreadsAttention } from "@/components/chat/room-attention";
import { ThreadGroupHeading } from "@/components/chat/thread-list-row";
import { UnreadThreadsList } from "@/components/chat/unread-threads-list";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";
import { cn } from "@/lib/utils";

interface UnreadThreadsViewProps {
  /** Core's first page at request time, or null when that read failed. */
  initialPage: ChatUnreadThreadsPage | null;
  /** The rooms as the sidebar cache held them, until the live read lands. */
  initialRooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * The Threads page (SOK-1159): every Thread the reader is part of, the
 * unread ones first and then Earlier, as a room's own Thread list groups
 * them. Where the Threads row goes on click, and the only way in on the
 * phone. Its unread group is the flyout's list.
 */
export function UnreadThreadsView({
  initialPage,
  initialRooms,
  currentUserId,
}: UnreadThreadsViewProps) {
  const t = useTranslations("App.Channels.ThreadsView");
  const tGroups = useTranslations("App.Channels.UnreadThreads");
  const unreadHeadingId = useId();
  // Null until the live read lands; an empty list is an answer, not a gap.
  // Once a live read has landed, null is that read being dropped (a workspace
  // switch clears it, SOK-903). The page's rooms are the workspace it
  // rendered, so they must not fill that gap.
  const liveRooms = useLiveChatRooms();
  const sawLiveRooms = useRef(false);
  if (liveRooms !== null) {
    sawLiveRooms.current = true;
  }
  const roomsLive = liveRooms !== null;
  const rooms = liveRooms ?? (sawLiveRooms.current ? [] : initialRooms);
  const { threadCount } = resolveUnreadThreadsAttention(rooms);

  return (
    <div className="flex w-full flex-col gap-4 pb-4">
      <ChatUnreadViewHeader title={t("title")} />
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        <section
          aria-labelledby={unreadHeadingId}
          className={cn(HOLDER_ITEM_CLASS, "flex flex-col px-2 pb-2")}
        >
          <ThreadGroupHeading id={unreadHeadingId} count={threadCount}>
            {tGroups("groupUnread")}
          </ThreadGroupHeading>
          <UnreadThreadsList
            rooms={rooms}
            roomsLive={roomsLive}
            initial={
              initialPage ? { page: initialPage, rooms: initialRooms } : null
            }
            currentUserId={currentUserId}
            variant="page"
          />
        </section>
        <div className={cn(HOLDER_ITEM_CLASS, "px-2 pb-2 empty:hidden")}>
          <EarlierThreadsList rooms={rooms} currentUserId={currentUserId} />
        </div>
      </div>
    </div>
  );
}
