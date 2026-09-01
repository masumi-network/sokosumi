"use client";

import { useSyncExternalStore } from "react";
import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "@/app/chat/chat-chats-list-shell";
import { ChatChatsListSnapshotPreview } from "@/app/chat/components/chat-chats-list-snapshot-preview";
import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  type MembershipVisibleRoomsSnapshot,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
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
 *
 * Uses a lightweight preview (no Ably/polls) so Instant stays a paint-only
 * shell; the streamed page mounts OrganizationChatList.
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

  return (
    <div
      data-testid="chat-chats-snapshot"
      className={CHAT_CHATS_MOBILE_LIST_SHELL_CLASS}
    >
      <ChatChatsListSnapshotPreview
        rooms={rooms}
        currentUserId={snapshot.currentUserId}
        organizationId={snapshot.organizationId}
      />
    </div>
  );
}
