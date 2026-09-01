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
    paintOnly,
  }: {
    rooms: ChatRoom[];
    paintOnly?: boolean;
  }) => (
    <div
      data-testid="paint-only-list"
      data-paint-only={String(Boolean(paintOnly))}
    >
      {rooms.map((room) => (
        <a
          key={room.id}
          href={`/chat/rooms/${room.id}`}
          className={room.unreadCount > 0 ? "font-semibold" : undefined}
        >
          {room.name}
        </a>
      ))}
    </div>
  ),
}));

import { ChatChatsPageSkeletonHost } from "./chat-chats-page-skeleton-host";

const STALE_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

function room(
  partial: Partial<ChatRoom> & Pick<ChatRoom, "id" | "name">,
): ChatRoom {
  return {
    kind: "channel",
    discoverability: "public",
    updatedAt: STALE_UPDATED_AT,
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
    mutedAt: null,
    userMembers: [],
    coworkerMembers: [],
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

  it("paints OrganizationChatList paintOnly with room unread overlay", () => {
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
    const list = screen.getByTestId("paint-only-list");
    expect(list.getAttribute("data-paint-only")).toBe("true");
    const link = screen.getByRole("link", { name: /general/i });
    expect(link.getAttribute("href")).toBe("/chat/rooms/room-1");
    // Overlay cleared unread → label is not bold (font-semibold).
    expect(link.className.includes("font-semibold")).toBe(false);
  });

  it("keeps bold unread chrome when overlay does not clear attention", () => {
    publishMembershipVisibleRooms(
      [room({ id: "room-2", name: "alerts", unreadCount: 2 })],
      "org-1",
      "user-1",
    );

    render(<ChatChatsPageSkeletonHost />);

    const link = screen.getByRole("link", { name: /alerts/i });
    expect(link.className.includes("font-semibold")).toBe(true);
  });
});
