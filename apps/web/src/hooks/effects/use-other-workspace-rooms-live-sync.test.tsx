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

    // Room removal cancels pending reads, hides the room at once, invalidates
    // the prefix, and schedules a fresh read.
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

  it("cancels an in-flight read, removes the room at once, and invalidates on revocation so the older response cannot restore it", async () => {
    vi.useRealTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });
    queryClient.setQueryData<ChatRoom[]>(key, [
      sampleRoom("r1"),
      sampleRoom("r2"),
    ]);
    const olderRead = Promise.withResolvers<ChatRoom[]>();
    let aborted = false;

    const inFlight = queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return olderRead.promise;
        },
        staleTime: 0,
      })
      .catch(() => undefined);

    const requestRead = vi.fn();
    const { unmount } = render(
      <LiveSyncProbe queryClient={queryClient} requestRead={requestRead} />,
    );

    act(() => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
    });

    // Hidden immediately even before any follow-up read runs (or if it is throttled/fails).
    expect(aborted).toBe(true);
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2"],
    );
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(requestRead).toHaveBeenCalledTimes(1);

    await act(async () => {
      olderRead.resolve([sampleRoom("r1"), sampleRoom("r2")]);
      await inFlight;
    });

    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2"],
    );
    unmount();
    queryClient.clear();
  });

  it("aborts GET A on revocation and does not start GET B before GET A ends", async () => {
    vi.useRealTimers();
    const timestamp = "2026-11-23T12:00:00.000Z";
    const roomDto = (id: string) => ({
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
      createdAt: timestamp,
      updatedAt: timestamp,
      userMembers: [],
    });
    const okResponse = (ids: string[]) =>
      new Response(
        JSON.stringify({
          data: ids.map(roomDto),
          meta: {
            timestamp,
            requestId: "req-1",
            pagination: { nextCursor: null },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );

    let signalA: AbortSignal | undefined;
    const getA = Promise.withResolvers<Response>();
    const getB = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(["r1", "r2"]))
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        signalA = init?.signal ?? undefined;
        // Intentionally does not settle on abort so we can prove GET B waits
        // until GET A's transport actually finishes.
        return getA.promise;
      })
      .mockReturnValueOnce(getB.promise);
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });

    function Reader() {
      useOtherWorkspaceRooms({
        currentUserId: "u1",
        organizationId: "org1",
        enabled: true,
      });
      return null;
    }

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <OtherWorkspaceRoomsLive />
        <Reader />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id),
      ).toEqual(["r1", "r2"]),
    );

    // Start GET A via an active-collection invalidation.
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Revoke r1 while GET A is still in flight.
    await act(async () => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Abort reached the HTTP transport, r1 is already hidden, and GET B has
    // not started while GET A is still open.
    expect(signalA?.aborted).toBe(true);
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2"],
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Even if GET A finishes with stale [r1, r2], it never restores r1, and
    // only now does GET B start.
    await act(async () => {
      getA.resolve(okResponse(["r1", "r2"]));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2"],
    );

    await act(async () => {
      getB.resolve(okResponse(["r2"]));
    });
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2"],
    );

    unmount();
    queryClient.clear();
  });

  it("keeps a pending active-change timer across revocation so it still enters the scheduler and defers through a 429 throttle", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const timestamp = "2026-11-23T12:00:00.000Z";
    const roomDto = (id: string) => ({
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
      createdAt: timestamp,
      updatedAt: timestamp,
      userMembers: [],
    });
    const okResponse = (ids: string[]) =>
      new Response(
        JSON.stringify({
          data: ids.map(roomDto),
          meta: {
            timestamp,
            requestId: "req-1",
            pagination: { nextCursor: null },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(["r1", "r2"])) // mount
      .mockResolvedValueOnce(okResponse(["r1", "r2"])) // t=0 active change
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 429,
          headers: { "Retry-After": "5" },
        }),
      ) // t=200ms revocation read -> throttled until t=5200ms
      .mockResolvedValueOnce(okResponse(["r2", "r3"])); // t=5200ms catch-up after throttle
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });

    function Reader() {
      useOtherWorkspaceRooms({
        currentUserId: "u1",
        organizationId: "org1",
        enabled: true,
      });
      return null;
    }

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <OtherWorkspaceRoomsLive />
        <Reader />
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // t=0: first active change reads immediately.
    await act(async () => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // t=100ms: second active change queues the 2s window timer (fires at t=2000ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // t=200ms: revocation arrives and its follow-up read gets 429 (Retry-After: 5s -> t=5200ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2"],
    );

    // t=2000ms: the t=100ms active-change timer fires into the scheduler and
    // defers through the 429 throttle instead of firing inside the window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_800);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // t=5200ms: throttle ends; the deferred active-change read runs and lands r3.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r2", "r3"],
    );

    unmount();
    queryClient.clear();
  });
});
