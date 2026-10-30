import type { ChatRoom } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import { getRoomDisplayName } from "@/app/chat/components/room-helpers";

/**
 * `getRoomDisplayName` with the reader's Self Direct named "Name (you)" in
 * their locale, for the surfaces that name rooms: the sidebar, the open
 * room's header and the Threads rows.
 */
export function useRoomDisplayName(): (
  room: ChatRoom,
  currentUserId: string,
) => string {
  const t = useTranslations("App.Channels");
  return (room, currentUserId) =>
    getRoomDisplayName(room, currentUserId, (name) =>
      t("SelfDirect.youNamed", { name }),
    );
}
