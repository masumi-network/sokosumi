import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  notifyOrganizationChatRoomsChanged,
  ORGANIZATION_CHAT_ROOM_READ_EVENT,
} from "@/components/chat/organization-chat-events";
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

    // Room removal invalidates cached queries and requests a fresh read instead of patching.
    act(() => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r2" });
    });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(requestRead).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["r1", "r2"],
    );

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

  it("cancels an in-flight read and invalidates when membership is revoked so the older response cannot restore the room", async () => {
    vi.useRealTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = chatQueryKeys.elsewhere({ userId: "u1", workspaceId: "org1" });
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
      })
      .catch(() => undefined);

    const requestRead = vi.fn();
    const { unmount } = render(
      <LiveSyncProbe queryClient={queryClient} requestRead={requestRead} />,
    );

    act(() => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r1" });
    });

    expect(aborted).toBe(true);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(requestRead).toHaveBeenCalledTimes(1);

    await act(async () => {
      olderRead.resolve([sampleRoom("r1")]);
      await inFlight;
    });

    expect(queryClient.getQueryData<ChatRoom[]>(key)).toBeUndefined();
    unmount();
    queryClient.clear();
  });
});
