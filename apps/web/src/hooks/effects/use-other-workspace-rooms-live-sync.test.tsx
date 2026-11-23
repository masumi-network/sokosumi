import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  notifyOrganizationChatRoomsChanged,
  ORGANIZATION_CHAT_ROOM_READ_EVENT,
} from "@/components/chat/organization-chat-events";
import {
  OtherWorkspaceRoomsLive,
  useOtherWorkspaceRooms,
} from "@/components/chat/use-other-workspace-rooms";
import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";
import { chatQueryKeys } from "@/queries/chat";
import { useOtherWorkspaceRoomsLiveSync } from "./use-other-workspace-rooms-live-sync";

function LiveSyncProbe({
  queryClient,
  requestRead,
}: {
  queryClient: QueryClient;
  requestRead: () => void;
}) {
  useOtherWorkspaceRoomsLiveSync(queryClient, requestRead);
  return null;
}

function sampleRoom(id: string): ChatRoom {
  return {
    id,
    organizationName: "Globex",
    organizationLogo: null,
    organizationWebsiteUrl: "https://globex.example",
    unreadCount: 2,
  } as ChatRoom;
}

const TS = "2026-11-23T12:00:00.000Z";
const KEY = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });

function okResponse(ids: string[]): Response {
  const data = ids.map((id) => ({
    id,
    organizationId: "org2",
    organizationName: "Globex",
    organizationLogo: null,
    organizationWebsiteUrl: "https://globex.example",
    unreadCount: 2,
    channelUnreadCount: 2,
    unreadMentionCount: 0,
    markedUnread: false,
    starredAt: null,
    mutedAt: null,
    createdAt: TS,
    updatedAt: TS,
    userMembers: [],
  }));
  return new Response(
    JSON.stringify({
      data,
      meta: {
        timestamp: TS,
        requestId: "req-1",
        pagination: { nextCursor: null },
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function mountLiveReader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Reader() {
    useOtherWorkspaceRooms({
      currentUserId: "u1",
      organizationId: "org1",
      enabled: true,
    });
    return null;
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OtherWorkspaceRoomsLive />
      <Reader />
    </QueryClientProvider>,
  );
  const roomIds = () =>
    queryClient.getQueryData<ChatRoom[]>(KEY)?.map((r) => r.id);
  return {
    queryClient,
    roomIds,
    unmount: () => {
      view.unmount();
      queryClient.clear();
    },
  };
}

describe("useOtherWorkspaceRoomsLiveSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetChatReadThrottleForTests();
    vi.useRealTimers();
  });

  it("removes rooms, applies read updates preserving workspace metadata, and throttles active invalidations", () => {
    const queryClient = new QueryClient();
    const key = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });
    queryClient.setQueryData<ChatRoom[]>(key, [
      sampleRoom("r1"),
      sampleRoom("r2"),
    ]);
    const requestRead = vi.fn();

    const { unmount } = render(
      <LiveSyncProbe queryClient={queryClient} requestRead={requestRead} />,
    );

    // Non-active invalidation is ignored.
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["archived"] });
    });
    expect(requestRead).not.toHaveBeenCalled();

    // First active invalidation reads immediately; second within 2s is coalesced.
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    expect(requestRead).toHaveBeenCalledTimes(1);

    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    expect(requestRead).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(requestRead).toHaveBeenCalledTimes(2);

    // Room removal hides the room at once, invalidates the prefix, and schedules a read.
    act(() => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r2" });
    });
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r1"],
    );
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(requestRead).toHaveBeenCalledTimes(3);

    // Room read preserves organizationName via withWorkspaceOf.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOM_READ_EVENT, {
          detail: {
            roomId: "r1",
            room: {
              ...sampleRoom("r1"),
              organizationName: null,
              unreadCount: 0,
            },
          },
        }),
      );
    });
    const updated = queryClient.getQueryData<ChatRoom[]>(key)?.[0];
    expect(updated?.unreadCount).toBe(0);
    expect(updated?.organizationName).toBe("Globex");

    unmount();
    queryClient.clear();
  });

  it("unsubscribes and clears pending throttle timer on StrictMode replay, Activity hide, and unmount", () => {
    const queryClient = new QueryClient();
    const requestRead = vi.fn();

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <LiveSyncProbe queryClient={queryClient} requestRead={requestRead} />
        </Activity>
      </StrictMode>,
    );

    // First invalidation fires once (not twice — StrictMode cleanup unsubscribed the first listener).
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    expect(requestRead).toHaveBeenCalledTimes(1);

    // Queue a throttled read, then hide under Activity: timer is cancelled and listener unsubscribes.
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <LiveSyncProbe queryClient={queryClient} requestRead={requestRead} />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    expect(requestRead).toHaveBeenCalledTimes(1);

    // Reveal re-subscribes cleanly.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <LiveSyncProbe queryClient={queryClient} requestRead={requestRead} />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    expect(requestRead).toHaveBeenCalledTimes(2);

    unmount();
    const key = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });
    queryClient.setQueryData<ChatRoom[]>(key, [sampleRoom("r1")]);
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
      window.dispatchEvent(
        new CustomEvent(ORGANIZATION_CHAT_ROOM_READ_EVENT, {
          detail: {
            roomId: "r1",
            room: { ...sampleRoom("r1"), unreadCount: 0 },
          },
        }),
      );
    });
    expect(requestRead).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.[0]?.unreadCount).toBe(2);
    queryClient.clear();
  });

  it("drops a revoked room from an older in-flight read without overlapping a second GET, and shows it on a later read", async () => {
    vi.useRealTimers();
    const getA = Promise.withResolvers<Response>();
    const getB = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(["r1", "r2"]))
      .mockReturnValueOnce(getA.promise)
      .mockReturnValueOnce(getB.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { roomIds, unmount } = mountLiveReader();
    await waitFor(() => expect(roomIds()).toEqual(["r1", "r2"]));

    act(() => notifyOrganizationChatRoomsChanged({ collections: ["active"] }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Revoke during GET A: r1 hides immediately and no second GET overlaps.
    await act(async () => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(roomIds()).toEqual(["r2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Older GET A resolves with [r1, r2]: r1 stays dropped; GET B starts after A ends.
    await act(async () => getA.resolve(okResponse(["r1", "r2"])));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(roomIds()).toEqual(["r2"]);

    // Newer GET B started after revocation (e.g. rejoin): r1 shows again.
    await act(async () => getB.resolve(okResponse(["r1", "r2"])));
    await waitFor(() => expect(roomIds()).toEqual(["r1", "r2"]));
    unmount();
  });

  it("keeps a pending active-change timer across revocation so it defers through a 429 throttle", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(["r1", "r2"])) // mount
      .mockResolvedValueOnce(okResponse(["r1", "r2"])) // t=0 active change
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "Retry-After": "5" } }),
      ) // t=200ms revoke -> throttled until t=5200ms
      .mockResolvedValueOnce(okResponse(["r2", "r3"])); // t=5200ms catch-up
    vi.stubGlobal("fetch", fetchMock);

    const { roomIds, unmount } = mountLiveReader();
    await act(() => vi.advanceTimersByTimeAsync(0));

    // t=0: reads immediately; t=100ms: queues 2s timer; t=200ms: revoke hits 429.
    await act(async () => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      await vi.advanceTimersByTimeAsync(100);
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(roomIds()).toEqual(["r2"]);

    // t=2000ms: pending active-change timer enters scheduler and defers through 429.
    await act(() => vi.advanceTimersByTimeAsync(1_800));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // t=5200ms: throttle ends; deferred read runs and lands r3.
    await act(() => vi.advanceTimersByTimeAsync(3_200));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(roomIds()).toEqual(["r2", "r3"]);
    unmount();
  });
});
