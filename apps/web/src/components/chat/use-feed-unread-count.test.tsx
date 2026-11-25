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

function room(unreadCount: number, unreadNeedsYouCount = 0): ChatRoom {
  return { id: "room-1", unreadCount, unreadNeedsYouCount } as ChatRoom;
}

function renderCount() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useFeedUnreadCount({ currentUserId: "user-1", organizationId: "org-1" }),
    { wrapper },
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useFeedUnreadCount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchChatFeedMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the count again once after the rooms' unread changes", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 1 })
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 0 });
    liveRooms.current = [room(1)];
    const { result, rerender } = renderCount();
    await advance(0);
    expect(result.current.unreadCount).toBe(1);
    // Rooms present at mount are not a change.
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);

    liveRooms.current = [room(0)];
    rerender();
    // Renders inside the wait do not restart or drop it.
    rerender();
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(0);
  });

  it("reads again when rooms load after the count", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 0 })
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 1 });
    liveRooms.current = null;
    const { result, rerender } = renderCount();
    await advance(0);
    // A Direct lands before the rooms load: they arrive already unread.
    liveRooms.current = [room(1)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(1);
  });

  it("reads again when only needs-you changes", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 0 })
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 1 });
    liveRooms.current = [room(1)];
    const { result, rerender } = renderCount();
    await advance(0);
    // A question tagged for the reader on a message already unread.
    liveRooms.current = [room(1, 1)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(1);
  });
});
