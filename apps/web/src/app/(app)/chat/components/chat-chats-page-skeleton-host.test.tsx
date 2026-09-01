import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import {
  clearRoomReadOverlays,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import type { ChatRoom } from "@/lib/clients/generated/core";

vi.mock("@/components/chat/organization-chat-list.client", () => ({
  OrganizationChatList: ({
    rooms,
  }: {
    rooms: Array<{ id: string; name?: string; unreadCount?: number }>;
  }) => (
    <ul data-testid="snapshot-list">
      {rooms.map((room) => (
        <li
          key={room.id}
          data-room-id={room.id}
          data-unread={String(room.unreadCount ?? 0)}
        >
          {room.name ?? room.id}
        </li>
      ))}
    </ul>
  ),
}));

import { ChatChatsPageSkeletonHost } from "./chat-chats-page-skeleton-host";

const STALE_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

function room(
  partial: Partial<ChatRoom> & Pick<ChatRoom, "id" | "name">,
): ChatRoom {
  return {
    kind: "channel",
    updatedAt: STALE_UPDATED_AT,
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
    mutedAt: null,
    userMembers: [],
    ...partial,
  } as ChatRoom;
}

describe("ChatChatsPageSkeletonHost", () => {
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
  });

  it("paints bone rows when no session snapshot exists", () => {
    render(<ChatChatsPageSkeletonHost />);
    expect(screen.getByTestId("chat-chats-loading")).toBeTruthy();
    expect(screen.queryByTestId("chat-chats-snapshot")).toBeNull();
  });

  it("paints the last-known list with room unread overlay when published", () => {
    const stale = room({
      id: "room-1",
      name: "general",
      unreadCount: 4,
      updatedAt: STALE_UPDATED_AT,
    });
    publishMembershipVisibleRooms([stale], "org-1", "user-1");
    rememberRoomRead({
      id: "room-1",
      updatedAt: STALE_UPDATED_AT,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });

    render(<ChatChatsPageSkeletonHost />);

    expect(screen.queryByTestId("chat-chats-loading")).toBeNull();
    expect(screen.getByTestId("chat-chats-snapshot")).toBeTruthy();
    const row = screen.getByText("general");
    expect(row.closest("[data-unread]")?.getAttribute("data-unread")).toBe("0");
  });
});
