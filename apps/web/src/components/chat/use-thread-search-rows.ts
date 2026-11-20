"use client";

import type { ChatRoom, ChatUnreadThread } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import { roomMentionNames } from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { usePageListSearch } from "@/components/page-list-search";

/** A Thread row's two names: the Thread's, from its parent, and its room's. */
export function useThreadSearchRows<
  Thread extends Pick<
    ChatUnreadThread,
    "roomId" | "parentMessageId" | "parentContent"
  >,
>(
  threads: readonly Thread[],
  rooms: readonly ChatRoom[],
  currentUserId: string,
) {
  const t = useTranslations("App.Channels.ThreadRows");
  const tChannels = useTranslations("App.Channels");
  const displayName = useRoomDisplayName();
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const seen = new Set<string>();
  const rows = threads.flatMap((thread) => {
    // A room muted or left since the page was read lists nothing here, as
    // it lists nothing in the sidebar.
    const room = roomsById.get(thread.roomId);
    if (!room || room.mutedAt != null || seen.has(thread.parentMessageId))
      return [];
    seen.add(thread.parentMessageId);
    const name = displayName(room, currentUserId);
    const label =
      formatUnreadThreadsPreview(
        thread.parentContent,
        roomMentionNames(room, tChannels("MentionAll.label")),
      ) || t("untitled");
    return [
      { thread, label, roomName: room.kind === "channel" ? `#${name}` : name },
    ];
  });
  const matching = usePageListSearch(rows, ({ label, roomName }) => ({
    primary: [label],
    secondary: [roomName],
  }));
  return { rows, matching };
}
