import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRoom } from "@/lib/clients/generated/core";

let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  listOrganizationChatRoomsAction: vi.fn(),
}));

import { listOrganizationChatRoomsAction } from "@/components/chat/organization-chat-list.actions";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";

import {
  getActiveRoomIdFromPathname,
  useChatTabUnreadPresence,
} from "../use-chat-tab-unread-presence";

const listRoomsMock = vi.mocked(listOrganizationChatRoomsAction);

function room(partial: Partial<ChatRoom> & Pick<ChatRoom, "id">): ChatRoom {
  return {
    name: partial.name ?? partial.id,
    type: "channel",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
    mutedAt: null,
    userMembers: [],
    ...partial,
  } as ChatRoom;
}

function Harness() {
  const { showUnreadDot } = useChatTabUnreadPresence();
  return (
    <div data-testid="presence" data-show={showUnreadDot ? "yes" : "no"} />
  );
}

describe("getActiveRoomIdFromPathname", () => {
  it("extracts the room id from /chat/rooms/[id]", () => {
    expect(getActiveRoomIdFromPathname("/chat/rooms/room-1")).toBe("room-1");
  });

  it("returns null outside room routes", () => {
    expect(getActiveRoomIdFromPathname("/chat")).toBeNull();
    expect(getActiveRoomIdFromPathname("/chat/something")).toBeNull();
    expect(getActiveRoomIdFromPathname(null)).toBeNull();
  });
});

describe("useChatTabUnreadPresence", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    clearRoomReadOverlays();
    listRoomsMock.mockReset();
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [], nextCursor: null },
    });
  });

  afterEach(() => {
    clearRoomReadOverlays();
  });

  it("shows unread when a non-active room has attention", async () => {
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [room({ id: "a", unreadCount: 2 })], nextCursor: null },
    });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("presence")).toHaveAttribute(
        "data-show",
        "yes",
      );
    });
  });

  it("hides unread for the active room even when that room reports attention", async () => {
    mockPathname = "/chat/rooms/a";
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [room({ id: "a", unreadCount: 2 })], nextCursor: null },
    });

    render(<Harness />);

    await waitFor(() => {
      expect(listRoomsMock).toHaveBeenCalled();
    });
    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no");
  });

  it("keeps previous presence when a later poll fails", async () => {
    listRoomsMock
      .mockResolvedValueOnce({
        ok: true,
        value: { rooms: [room({ id: "a", unreadCount: 1 })], nextCursor: null },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "fail" },
      });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("presence")).toHaveAttribute(
        "data-show",
        "yes",
      );
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(listRoomsMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "yes");
  });

  it("clears presence after a room-read event for the last unread room", async () => {
    const unread = room({ id: "a", unreadCount: 3 });
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [unread], nextCursor: null },
    });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("presence")).toHaveAttribute(
        "data-show",
        "yes",
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("organization-chat-room-read", {
          detail: {
            roomId: "a",
            room: room({
              id: "a",
              unreadCount: 0,
              unreadMentionCount: 0,
              markedUnread: false,
            }),
          },
        }),
      );
    });

    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no");
  });
});
