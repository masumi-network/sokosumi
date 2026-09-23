"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { ChatUnreadViewHeader } from "@/app/chat/components/chat-unread-view-header";
import { EarlierThreadsList } from "@/components/chat/earlier-threads-list";
import { UnreadThreadsList } from "@/components/chat/unread-threads-list";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import type { ChatRoom } from "@/lib/clients/generated/core";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";

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
  const liveRooms = useLiveChatRooms();
  const roomsLive = liveRooms !== null;

  const rooms = liveRooms ?? initialRooms;

  return (
    <div className="flex flex-col gap-5 pb-4">
      <ChatUnreadViewHeader title={t("title")} />
      <section
        aria-labelledby={unreadHeadingId}
        className="flex flex-col gap-2"
      >
        <h2
          id={unreadHeadingId}
          className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase"
        >
          {tGroups("groupUnread")}
        </h2>
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
      <EarlierThreadsList rooms={rooms} currentUserId={currentUserId} />
    </div>
  );
}
