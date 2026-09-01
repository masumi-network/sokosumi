"use client";

import { useSyncExternalStore } from "react";
import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "@/app/chat/chat-chats-list-shell";
import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  type MembershipVisibleRoomsSnapshot,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import {
  getPersonalAssistantChromeVisible,
  subscribePersonalAssistantChromeVisible,
} from "@/components/chat/personal-assistant-chrome-store";
import { applyRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function getClientSnapshot(): MembershipVisibleRoomsSnapshot | null {
  return getLatestMembershipVisibleRoomsSnapshot();
}

function getServerSnapshot(): MembershipVisibleRoomsSnapshot | null {
  return null;
}

function getPersonalAssistantClientSnapshot(): boolean {
  return getPersonalAssistantChromeVisible();
}

function getPersonalAssistantServerSnapshot(): boolean {
  return false;
}

/**
 * Instant Nav host for `/chat`: when this session already published membership-
 * visible rooms, first-paint that snapshot with Room unread overlay instead of
 * bone rows. Cold load (no snapshot yet) keeps ChatChatsPageSkeleton.
 *
 * Uses OrganizationChatList in `paintOnly` mode so section headers and row
 * trailing chrome match the streamed page (no Ably/polls). When Personal
 * Assistant was shown this session (beta), paint that row + separator too so
 * soft-nav back does not jump when RSC lands (SOK-903). Snapshot paint is
 * non-interactive so taps during the flash cannot open create/menus.
 */
export function ChatChatsPageSkeletonHost() {
  const snapshot = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    getClientSnapshot,
    getServerSnapshot,
  );
  const personalAssistantVisible = useSyncExternalStore(
    subscribePersonalAssistantChromeVisible,
    getPersonalAssistantClientSnapshot,
    getPersonalAssistantServerSnapshot,
  );

  if (snapshot == null) {
    return <ChatChatsPageSkeleton />;
  }

  const rooms = applyRoomReadOverlays([...snapshot.rooms]);

  return (
    <Sheet open>
      <div
        data-testid="chat-chats-snapshot"
        className={cn(
          CHAT_CHATS_MOBILE_LIST_SHELL_CLASS,
          "pointer-events-none",
        )}
      >
        {personalAssistantVisible ? (
          <>
            <PersonalAssistantNav />
            <SidebarSeparator className="-mt-px" />
          </>
        ) : null}
        <OrganizationChatList
          rooms={rooms}
          archivedRooms={[]}
          currentUserId={snapshot.currentUserId}
          organizationId={snapshot.organizationId}
          canDeleteArchivedRooms={false}
          dismissSheetOnNavigate={false}
          paintOnly
        />
      </div>
    </Sheet>
  );
}
