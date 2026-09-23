"use client";

import { useTranslations } from "next-intl";

import { ChatUnreadViewHeader } from "@/app/chat/components/chat-unread-view-header";
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
 * The Threads page (SOK-1159): where the Threads entry lands on the phone,
 * which has no side for the desktop popover to open into, and the address a
 * link to the list can share. The list is the popover's.
 */
export function UnreadThreadsView({
  initialPage,
  initialRooms,
  currentUserId,
}: UnreadThreadsViewProps) {
  const t = useTranslations("App.Channels.ThreadsView");
  // Null until the live read lands; an empty list is an answer, not a gap.
  const liveRooms = useLiveChatRooms();
  const roomsLive = liveRooms !== null;

  return (
    <div className="flex flex-col gap-5 pb-4">
      <ChatUnreadViewHeader title={t("title")} />
      <UnreadThreadsList
        rooms={liveRooms ?? initialRooms}
        roomsLive={roomsLive}
        initial={
          initialPage ? { page: initialPage, rooms: initialRooms } : null
        }
        currentUserId={currentUserId}
      />
    </div>
  );
}
