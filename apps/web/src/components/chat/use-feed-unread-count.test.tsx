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

function room(
  unreadCount: number,
  { unreadNeedsYouCount = 0, mutedAt = null as string | null } = {},
): ChatRoom {
  return {
    id: "room-1",
    unreadCount,
    unreadNeedsYouCount,
    mutedAt,
  } as ChatRoom;
}

function feedCount(unreadCount: number) {
  return { items: [], nextCursor: null, unreadCount };
}

function renderCount(
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  }),
) {
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

  it("reads the count again once per burst of unread changes", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce(feedCount(1))
      .mockResolvedValueOnce(feedCount(0));
    liveRooms.current = [room(1)];
    const { result, rerender } = renderCount();
    await advance(0);
    expect(result.current.unreadCount).toBe(1);
    // Rooms present at mount are not a change.
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);

    liveRooms.current = [room(2)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS / 2);
    // A change inside the wait neither restarts it nor adds a read.
    liveRooms.current = [room(0)];
    rerender();
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);
    await advance(FEED_COUNT_REFRESH_DELAY_MS / 2);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(0);
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
  });

  it("reads again when rooms load after the count", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce(feedCount(0))
      .mockResolvedValueOnce(feedCount(1));
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

  it("reads again after a read still running at the change", async () => {
    let finishFirstRead: (value: ReturnType<typeof feedCount>) => void =
      () => {};
    fetchChatFeedMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirstRead = resolve;
        }),
      )
      .mockResolvedValueOnce(feedCount(1));
    liveRooms.current = null;
    const { result, rerender } = renderCount();
    liveRooms.current = [room(1)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    // The first read started before the Direct and answers late.
    await act(async () => {
      finishFirstRead(feedCount(0));
    });
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(1);
  });

  it("lets every read finish while the rooms keep changing", async () => {
    const slowReadMs = FEED_COUNT_REFRESH_DELAY_MS * 1.5;
    let running = 0;
    let mostRunning = 0;
    let reads = 0;
    fetchChatFeedMock.mockImplementation(() => {
      reads += 1;
      const answer = feedCount(reads);
      running += 1;
      mostRunning = Math.max(mostRunning, running);
      return new Promise((resolve) =>
        setTimeout(() => {
          running -= 1;
          resolve(answer);
        }, slowReadMs),
      );
    });
    liveRooms.current = [room(0)];
    const { result, rerender } = renderCount();
    for (let unread = 1; unread <= 4; unread += 1) {
      liveRooms.current = [room(unread)];
      rerender();
      await advance(FEED_COUNT_REFRESH_DELAY_MS);
    }
    await advance(FEED_COUNT_REFRESH_DELAY_MS * 4);
    expect(mostRunning).toBe(1);
    expect(reads).toBeGreaterThan(1);
    // The last read finished and its count shows.
    expect(result.current.unreadCount).toBe(reads);
  });

  it("reads again on mount after a change it left waiting", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000 } },
    });
    fetchChatFeedMock
      .mockResolvedValueOnce(feedCount(3))
      .mockResolvedValueOnce(feedCount(0));
    liveRooms.current = [room(3)];
    const first = renderCount(client);
    await advance(0);
    liveRooms.current = [room(0)];
    first.rerender();
    first.unmount();
    const { result } = renderCount(client);
    await advance(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it("reads again on a remount that reuses a read from before the change", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000 } },
    });
    let finishFirstRead: (value: ReturnType<typeof feedCount>) => void =
      () => {};
    fetchChatFeedMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirstRead = resolve;
        }),
      )
      .mockResolvedValueOnce(feedCount(0));
    liveRooms.current = [room(3)];
    const first = renderCount(client);
    // The reader reads the room while the first read still runs.
    liveRooms.current = [room(0)];
    first.rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    first.unmount();
    const { result } = renderCount(client);
    await act(async () => {
      finishFirstRead(feedCount(3));
    });
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(0);
  });

  it("reads again when a change lands in the render that cleared the refresh", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce(feedCount(1))
      .mockImplementationOnce(async () => {
        // The next message arrives while the refresh starts its read.
        liveRooms.current = [room(3)];
        return feedCount(2);
      })
      .mockResolvedValueOnce(feedCount(3));
    liveRooms.current = [room(1)];
    const { result, rerender } = renderCount();
    await advance(0);
    liveRooms.current = [room(2)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(3);
    expect(result.current.unreadCount).toBe(3);
  });

  it("reads once for a change both Feed rows on the page see", async () => {
    fetchChatFeedMock
      .mockResolvedValueOnce(feedCount(1))
      .mockResolvedValueOnce(feedCount(0));
    liveRooms.current = [room(1)];
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const scope = { currentUserId: "user-1", organizationId: "org-1" };
    const { result, rerender } = renderHook(
      () => [useFeedUnreadCount(scope), useFeedUnreadCount(scope)],
      { wrapper },
    );
    await advance(0);
    liveRooms.current = [room(0)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS * 3);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current[1]?.unreadCount).toBe(0);
  });

  it("does not read again when no rooms load after the count", async () => {
    fetchChatFeedMock.mockResolvedValue(feedCount(0));
    liveRooms.current = null;
    const { rerender } = renderCount();
    await advance(0);
    liveRooms.current = [];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS * 2);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);
  });

  it("does not read again when rooms only change places", async () => {
    fetchChatFeedMock.mockResolvedValue(feedCount(1));
    const other = { ...room(0), id: "room-2" };
    liveRooms.current = [room(1), other];
    const { rerender } = renderCount();
    await advance(0);
    liveRooms.current = [other, room(1)];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["needs-you changes", room(1, { unreadNeedsYouCount: 1 })],
    ["the room is muted", room(1, { mutedAt: "2026-11-25T00:00:00Z" })],
  ])("reads again when only %s", async (_label, changed) => {
    fetchChatFeedMock
      .mockResolvedValueOnce(feedCount(0))
      .mockResolvedValueOnce(feedCount(1));
    liveRooms.current = [room(1)];
    const { result, rerender } = renderCount();
    await advance(0);
    liveRooms.current = [changed];
    rerender();
    await advance(FEED_COUNT_REFRESH_DELAY_MS);
    expect(fetchChatFeedMock).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(1);
  });
});
