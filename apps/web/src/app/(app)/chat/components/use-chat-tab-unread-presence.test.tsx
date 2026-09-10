import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRoom } from "@/lib/clients/generated/core";

let mockPathname = "/chat";
let mockUserId = "user-1";
let mockOrganizationId: string | null = "org-1";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: mockUserId
      ? {
          user: { id: mockUserId },
          session: { activeOrganizationId: mockOrganizationId },
        }
      : null,
  }),
}));

const { listRoomsMock } = vi.hoisted(() => ({ listRoomsMock: vi.fn() }));

/** Same `{ ok, value }` shape the action tests used; the GET helper maps it. */
type ListResult =
  | { ok: true; value: { rooms: ChatRoom[]; nextCursor: string | null } }
  | { ok: false; error?: unknown };

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: async () => {
    const result = (await listRoomsMock()) as ListResult;
    return result.ok ? result.value : null;
  },
}));

import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import {
  beginRoomAttentionChange,
  clearRoomReadOverlays,
  rememberRoomRead,
  settleRoomAttentionChange,
} from "@/components/chat/room-read-overlay";

import { useChatTabUnreadPresence } from "./use-chat-tab-unread-presence";

let hasFocus: ReturnType<typeof vi.spyOn>;

/**
 * Leave the foreground, learn the rooms changed while away, and come back.
 * The invalidation reads at once (the unread dot needs it); the return then
 * has nothing stale left, so the round is exactly one read.
 */
function returnToForeground() {
  hasFocus.mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("organization-chat-rooms-changed"));
  hasFocus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
}

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

describe("useChatTabUnreadPresence", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockUserId = "user-1";
    mockOrganizationId = "org-1";
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    listRoomsMock.mockReset();
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [], nextCursor: null },
    });
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
  });

  it("seeds the unread dot from the session snapshot before fetch", () => {
    publishMembershipVisibleRooms(
      [room({ id: "a", unreadCount: 2 })],
      "org-1",
      "user-1",
    );

    render(<Harness />);

    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "yes");
  });

  it("applies room-read overlay when seeding from the session snapshot", () => {
    const stale = room({ id: "a", unreadCount: 3 });
    publishMembershipVisibleRooms([stale], "org-1", "user-1");
    rememberRoomRead({
      id: "a",
      updatedAt: stale.updatedAt,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });

    render(<Harness />);

    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no");
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

    await act(async () => returnToForeground());

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

describe("authoritative tab attention", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockUserId = "user-1";
    mockOrganizationId = "org-1";
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    listRoomsMock.mockReset();
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never overlaps a slow read and re-arms the fallback poll after it completes", async () => {
    vi.useFakeTimers();
    const responseDelayMs = 16_000;
    listRoomsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                value: {
                  rooms: [room({ id: "slow-room", unreadCount: 4 })],
                  nextCursor: null,
                },
              }),
            responseDelayMs,
          );
        }),
    );
    const { unmount } = render(<Harness />);
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      // Mount read (0–16s), 15s fallback timer, second read (31–47s), timer.
      expect(listRoomsMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("presence")).toHaveAttribute(
        "data-show",
        "yes",
      );
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("shows remote Mark unread at the same timestamp despite a local read snapshot", async () => {
    const readRoom = room({ id: "a" });
    rememberRoomRead(readRoom);
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [{ ...readRoom, markedUnread: true }], nextCursor: null },
    });
    render(<Harness />);

    await waitFor(() =>
      expect(screen.getByTestId("presence")).toHaveAttribute(
        "data-show",
        "yes",
      ),
    );
  });

  it("clears the dot after remote Thread Look without changing room activity", async () => {
    const unread = room({ id: "a", unreadCount: 2 });
    rememberRoomRead(unread);
    publishMembershipVisibleRooms([unread], "org-1", "user-1");
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [{ ...unread, unreadCount: 0 }], nextCursor: null },
    });
    render(<Harness />);

    await waitFor(() =>
      expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no"),
    );
  });

  it("queues one follow-up read behind an in-flight read instead of overlapping", async () => {
    const older = Promise.withResolvers<ListResult>();
    const newer = Promise.withResolvers<ListResult>();
    listRoomsMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(<Harness />);
    await act(async () => {
      window.dispatchEvent(new Event("organization-chat-rooms-changed"));
      window.dispatchEvent(new Event("organization-chat-rooms-changed"));
    });
    expect(listRoomsMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      older.resolve({
        ok: true,
        value: { rooms: [room({ id: "a" })], nextCursor: null },
      }),
    );
    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no");
    expect(listRoomsMock).toHaveBeenCalledTimes(2);
    await act(async () =>
      newer.resolve({
        ok: true,
        value: { rooms: [room({ id: "a", unreadCount: 1 })], nextCursor: null },
      }),
    );
    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "yes");
  });

  it("reads an invalidation while hidden so the unread dot can change while away", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [room({ id: "a" })], nextCursor: null },
    });
    render(<Harness />);
    await waitFor(() => {
      expect(listRoomsMock).toHaveBeenCalled();
    });
    listRoomsMock.mockClear();
    listRoomsMock.mockResolvedValue({
      ok: true,
      value: { rooms: [room({ id: "a", unreadCount: 2 })], nextCursor: null },
    });

    await act(async () => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(
        new CustomEvent("organization-chat-rooms-changed", {
          detail: { collections: ["active"] },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("presence")).toHaveAttribute(
        "data-show",
        "yes",
      );
    });
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it("ignores invalidations that do not name the active collection", async () => {
    render(<Harness />);
    await act(async () => undefined);
    listRoomsMock.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("organization-chat-rooms-changed", {
          detail: { collections: ["archived"] },
        }),
      );
    });
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("discards an in-flight read after a workspace switch", async () => {
    const older = Promise.withResolvers<ListResult>();
    const newer = Promise.withResolvers<ListResult>();
    listRoomsMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { rerender } = render(<Harness />);
    await act(async () => undefined);

    mockOrganizationId = "org-2";
    rerender(<Harness />);
    await act(async () =>
      older.resolve({
        ok: true,
        value: { rooms: [room({ id: "a", unreadCount: 5 })], nextCursor: null },
      }),
    );

    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no");
    await act(async () =>
      newer.resolve({
        ok: true,
        value: { rooms: [room({ id: "b", unreadCount: 1 })], nextCursor: null },
      }),
    );
    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "yes");
  });

  it("protects a local read completed during a tab refresh", async () => {
    const response = Promise.withResolvers<ListResult>();
    listRoomsMock.mockReturnValue(response.promise);
    render(<Harness />);
    const readRoom = room({ id: "a" });
    const token = beginRoomAttentionChange(readRoom);
    settleRoomAttentionChange(readRoom.id, token, readRoom);

    await act(async () =>
      response.resolve({
        ok: true,
        value: { rooms: [{ ...readRoom, unreadCount: 1 }], nextCursor: null },
      }),
    );
    expect(screen.getByTestId("presence")).toHaveAttribute("data-show", "no");
  });
});
