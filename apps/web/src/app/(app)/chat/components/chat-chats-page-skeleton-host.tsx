"use client";

import { useSyncExternalStore } from "react";
import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "@/app/chat/chat-chats-list-shell";
import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  type MembershipVisibleRoomsSnapshot,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { applyRoomReadOverlays } from "@/components/chat/room-read-overlay";

function getClientSnapshot(): MembershipVisibleRoomsSnapshot | null {
  return getLatestMembershipVisibleRoomsSnapshot();
}

function getServerSnapshot(): MembershipVisibleRoomsSnapshot | null {
  return null;
}

/**
 * Instant Nav host for `/chat`: when this session already published membership-
 * visible rooms, first-paint that snapshot with Room unread overlay instead of
 * bone rows. Cold load (no snapshot yet) keeps ChatChatsPageSkeleton.
 */
export function ChatChatsPageSkeletonHost() {
  const snapshot = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (snapshot == null) {
    return <ChatChatsPageSkeleton />;
  }

  const rooms = applyRoomReadOverlays([...snapshot.rooms]);
  const listKey = snapshot.organizationId ?? "personal";

  return (
    <div
      data-testid="chat-chats-snapshot"
      className={CHAT_CHATS_MOBILE_LIST_SHELL_CLASS}
    >
      <OrganizationChatList
        key={listKey}
        rooms={rooms}
        archivedRooms={[]}
        currentUserId={snapshot.currentUserId}
        organizationId={snapshot.organizationId}
        canDeleteArchivedRooms={false}
        dismissSheetOnNavigate={false}
      />
    </div>
  );
}
