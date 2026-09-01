import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/chat/direct-room-avatar-stack", () => ({
  DirectRoomAvatarStack: () => <span data-testid="dm-avatar" />,
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
    const link = screen.getByRole("link", { name: /general/i });
    expect(link.getAttribute("href")).toBe("/chat/rooms/room-1");
    // Overlay cleared unread → label is not bold (font-semibold).
    expect(link.querySelector(".font-semibold")).toBeNull();
  });

  it("keeps bold unread chrome when overlay does not clear attention", () => {
    publishMembershipVisibleRooms(
      [room({ id: "room-2", name: "alerts", unreadCount: 2 })],
      "org-1",
      "user-1",
    );

    render(<ChatChatsPageSkeletonHost />);

    const link = screen.getByRole("link", { name: /alerts/i });
    expect(link.querySelector(".font-semibold")).not.toBeNull();
  });
});
