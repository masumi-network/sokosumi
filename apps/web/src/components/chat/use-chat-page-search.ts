"use client";

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import {
  usePageListSearch,
  usePageSearchQuery,
} from "@/components/page-list-search";
import { rankPageItems } from "@/lib/utils/page-search";
import { limitSidebarSectionRooms } from "./limit-sidebar-section-rooms";

export function useChatPageSearch({
  rooms,
  elsewhere,
  archived,
  invitations,
  currentUserId,
}: {
  rooms: ChatRoom[];
  elsewhere: readonly ChatRoom[];
  archived: readonly ChatRoom[];
  invitations: ChatRoomInvitation[];
  currentUserId: string;
}) {
  const query = usePageSearchQuery();
  const active = Boolean(query);
  const displayName = useRoomDisplayName();
  const searchable = active
    ? [
        ...new Map(
          [
            ...rooms,
            ...elsewhere.filter((room) => room.starredAt == null),
            ...archived,
          ].map((room) => [room.id, room]),
        ).values(),
      ]
    : [];
  function fieldsFor(room: ChatRoom) {
    return {
      primary: [
        room.kind === "direct" ? displayName(room, currentUserId) : room.name,
        room.slug,
      ],
      secondary: [
        room.topic,
        room.organizationName,
        room.kind,
        room.discoverability,
        ...room.userMembers.map((member) => member.name),
        ...room.coworkerMembers.map((member) => member.name),
        ...room.sokoBotMembers.map((member) => member.name),
      ],
    };
  }
  usePageListSearch(searchable, fieldsFor);
  const matchingInvitations = usePageListSearch(invitations, (invitation) => ({
    primary: [invitation.roomName],
    secondary: [invitation.organizationName, invitation.inviter.name],
  }));
  function matching(rows: ChatRoom[]) {
    if (!active) return rows;
    return rankPageItems(rows, query, fieldsFor);
  }
  function limited(
    rows: ChatRoom[],
    showAll: boolean,
    alwaysShow: (room: ChatRoom) => boolean,
    limit: typeof limitSidebarSectionRooms<ChatRoom> = limitSidebarSectionRooms,
  ) {
    return active
      ? { visible: matching(rows), hiddenCount: 0 }
      : limit(rows, { showAll, alwaysShow });
  }
  return { active, matching, limited, invitations: matchingInvitations };
}
