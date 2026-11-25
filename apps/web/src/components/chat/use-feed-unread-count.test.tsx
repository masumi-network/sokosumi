import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FEED_COUNT_REFRESH_DELAY_MS,
  useFeedUnreadCount,
} from "./use-feed-unread-count";

const { fetchChatFeedMock, liveRooms } = vi.hoisted(() => ({
  fetchChatFeedMock: vi.fn(),
  liveRooms: { current: null as ChatRoom[] | null },
}));
vi.mock("@/components/chat/fetch-chat-feed", () => ({
  fetchChatFeed: fetchChatFeedMock,
}));
vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));
vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => true,
}));

function room(unreadCount: number): ChatRoom {
  return { id: "room-1", unreadCount } as ChatRoom;
}

describe("useFeedUnreadCount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchChatFeedMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the count again once the reader reads a room, after the burst settles", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 1 })
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 0 });
    liveRooms.current = null;
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      () =>
        useFeedUnreadCount({
          currentUserId: "user-1",
          organizationId: "org-1",
        }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.unreadCount).toBe(1);
    // The first rooms to load are not a change: no second read follows.
    liveRooms.current = [room(1)];
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FEED_COUNT_REFRESH_DELAY_MS);
    });
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);

    liveRooms.current = [room(0)];
    rerender();
    // Renders inside the wait do not restart or drop it.
    rerender();
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FEED_COUNT_REFRESH_DELAY_MS);
    });
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(0);
  });
});
