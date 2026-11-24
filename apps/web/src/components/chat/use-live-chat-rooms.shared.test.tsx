// @vitest-environment happy-dom

import type { ChatRoom } from "@sokosumi/core-client";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { Activity, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_HEALTHY_REFRESH_MS } from "@/components/chat/chat-refresh-scheduler";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
  registerMembershipVisibleRoomsPublisher,
} from "@/components/chat/membership-visible-rooms-store";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  beginRoomAttentionChange,
  clearRoomReadOverlays,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import { setAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";

const { fetchMock, sessionState, controlSubscribe, controlClient } = vi.hoisted(
  () => {
    const controlSubscribe = vi.fn();
    return {
      fetchMock: vi.fn(),
      sessionState: {
        userId: "user-1",
        organizationId: "org-1" as string | null,
      },
      controlSubscribe,
      controlClient: {
        connection: { state: "connected", on: vi.fn(), off: vi.fn() },
        channels: {
          get: () => ({ subscribe: controlSubscribe, unsubscribe: vi.fn() }),
        },
      },
    };
  },
);

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: sessionState.userId },
      session: { activeOrganizationId: sessionState.organizationId },
    },
  }),
}));

vi.mock("ably/react", () => ({
  useAbly: () => controlClient,
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ChatControlListBridge } from "@/components/chat/chat-control-list-bridge";
import { TestQueryProvider } from "@/test/query-provider";

import { useLiveChatRooms, useLiveChatRoomsRead } from "./use-live-chat-rooms";

const BASE_TIME = new Date("2026-11-24T10:00:00Z");

function makeRoom(overrides: Partial<ChatRoom> & { id: string }): ChatRoom {
  return {
    name: overrides.id,
    kind: "channel",
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
    updatedAt: BASE_TIME,
    starredAt: null,
    ...overrides,
  } as ChatRoom;
}

function Publisher() {
  useEffect(() => registerMembershipVisibleRoomsPublisher(), []);
  return null;
}

describe("useLiveChatRooms shared reader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ rooms: [], nextCursor: null });
    controlSubscribe.mockClear();
    sessionState.userId = "user-1";
    sessionState.organizationId = "org-1";
    setAblyConnectionHealthy(true);
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    resetChatReadThrottleForTests();
    vi.stubGlobal("innerWidth", 390);
  });

  afterEach(() => {
    cleanup();
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    resetChatReadThrottleForTests();
    setAblyConnectionHealthy(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("interleaving 16 (with Ably control channel): phone, no list, three readers, one active message -> 1 request; other collection -> 0", async () => {
    const initial = [makeRoom({ id: "r1", unreadCount: 0 })];
    const updated = [makeRoom({ id: "r1", unreadCount: 2 })];
    fetchMock.mockResolvedValueOnce({ rooms: initial, nextCursor: null });

    const seen1: Array<ChatRoom[] | null> = [];
    const seen2: Array<ChatRoom[] | null> = [];
    const seen3: Array<ChatRoom[] | null> = [];

    function Reader({ log }: { log: Array<ChatRoom[] | null> }) {
      log.push(useLiveChatRooms());
      return null;
    }

    const view = render(
      <TestQueryProvider>
        <ChatControlListBridge currentUserId="user-1" />
        <Reader log={seen1} />
        <Reader log={seen2} />
        <Reader log={seen3} />
      </TestQueryProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen1.at(-1)?.map((r) => r.unreadCount)).toEqual([0]);
    expect(seen2.at(-1)?.map((r) => r.unreadCount)).toEqual([0]);
    expect(seen3.at(-1)?.map((r) => r.unreadCount)).toEqual([0]);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ rooms: updated, nextCursor: null });

    const handler = controlSubscribe.mock.calls.find(
      ([name]) => name === "chat_rooms_changed",
    )?.[1];
    expect(handler).toBeTypeOf("function");

    // One active message from Ably -> exactly one active GET across all 3 readers.
    await act(async () => {
      handler({
        data: {
          collections: ["active"],
          roomId: "r1",
          at: "2026-11-24T10:01:00Z",
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    expect(seen1.at(-1)?.map((r) => r.unreadCount)).toEqual([2]);
    expect(seen2.at(-1)?.map((r) => r.unreadCount)).toEqual([2]);
    expect(seen3.at(-1)?.map((r) => r.unreadCount)).toEqual([2]);

    // Another collection (archived) -> zero requests.
    fetchMock.mockClear();
    await act(async () => {
      handler({
        data: {
          collections: ["archived"],
          roomId: "r1",
          at: "2026-11-24T10:02:00Z",
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    view.unmount();
  });

  it("D1 & D2: three healthy readers share 1 read per 60 s; fourth mounts later with no read and rows at once (overlay applied)", async () => {
    const r1 = makeRoom({ id: "r1", unreadCount: 3 });
    fetchMock.mockResolvedValue({ rooms: [r1], nextCursor: null });

    const reader1 = renderHook(() => useLiveChatRoomsRead());
    const reader2 = renderHook(() => useLiveChatRoomsRead());
    const reader3 = renderHook(() => useLiveChatRoomsRead());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reader1.result.current.rooms?.map((r) => r.id)).toEqual(["r1"]);
    expect(reader2.result.current.rooms?.map((r) => r.id)).toEqual(["r1"]);
    expect(reader3.result.current.rooms?.map((r) => r.id)).toEqual(["r1"]);

    // Advance 60 s while healthy: exactly one timer read across all three.
    fetchMock.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Local read overlay written before fourth reader mounts.
    rememberRoomRead({ ...r1, unreadCount: 0 });

    // D2: fourth reader mounts later -> zero fetches, rows at once with overlay.
    fetchMock.mockClear();
    const reader4 = renderHook(() => useLiveChatRoomsRead());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reader4.result.current).toEqual({
      rooms: [expect.objectContaining({ id: "r1", unreadCount: 0 })],
      failed: false,
    });

    reader1.unmount();
    reader2.unmount();
    reader3.unmount();
    reader4.unmount();
  });

  it("D4: a failed read marks every attached surface failed and clears on the next answer", async () => {
    fetchMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      rooms: [makeRoom({ id: "r1" })],
      nextCursor: null,
    });

    const reader1 = renderHook(() => useLiveChatRoomsRead());
    const reader2 = renderHook(() => useLiveChatRoomsRead());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reader1.result.current).toEqual({ rooms: null, failed: true });
    expect(reader2.result.current).toEqual({ rooms: null, failed: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reader1.result.current).toEqual({
      rooms: [expect.objectContaining({ id: "r1" })],
      failed: false,
    });
    expect(reader2.result.current).toEqual({
      rooms: [expect.objectContaining({ id: "r1" })],
      failed: false,
    });

    reader1.unmount();
    reader2.unmount();
  });

  it("rule 3 with two readers: when the list unmounts, exactly one takeover read starts and mirrored rows hold until it lands", async () => {
    const releasePublisher = registerMembershipVisibleRoomsPublisher();
    publishMembershipVisibleRooms(
      [makeRoom({ id: "mirrored", unreadCount: 1 })],
      "org-1",
      "user-1",
    );

    const takeover = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock.mockReturnValueOnce(takeover.promise);

    const reader1 = renderHook(() => useLiveChatRooms());
    const reader2 = renderHook(() => useLiveChatRooms());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reader1.result.current?.map((r) => r.id)).toEqual(["mirrored"]);
    expect(reader2.result.current?.map((r) => r.id)).toEqual(["mirrored"]);

    act(() => {
      releasePublisher();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reader1.result.current?.map((r) => r.id)).toEqual(["mirrored"]);
    expect(reader2.result.current?.map((r) => r.id)).toEqual(["mirrored"]);

    await act(async () => {
      takeover.resolve({
        rooms: [makeRoom({ id: "fresh", unreadCount: 2 })],
        nextCursor: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reader1.result.current?.map((r) => r.id)).toEqual(["fresh"]);
    expect(reader2.result.current?.map((r) => r.id)).toEqual(["fresh"]);

    reader1.unmount();
    reader2.unmount();
  });

  it("removes scheduler timers and window listeners when the last reader unmounts, and next mount starts as a first reader", async () => {
    fetchMock
      .mockResolvedValueOnce({
        rooms: [makeRoom({ id: "r1" })],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        rooms: [makeRoom({ id: "r2" })],
        nextCursor: null,
      });

    const reader1 = renderHook(() => useLiveChatRooms());
    const reader2 = renderHook(() => useLiveChatRooms());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    reader1.unmount();
    reader2.unmount();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Fresh reader starts as a first reader: triggers a fresh mount read and
    // does not seed from the released reader's old answer.
    const nextPending = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock.mockReset();
    fetchMock.mockReturnValueOnce(nextPending.promise);

    const reader3 = renderHook(() => useLiveChatRooms());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reader3.result.current).toBeNull();

    reader3.unmount();
  });

  it("reproduced interleaving 1 (phone): reader mounts before its sibling publisher in the same commit -> zero reader calls", async () => {
    function Reader() {
      useLiveChatRooms();
      return null;
    }

    const view = render(
      <>
        <Reader />
        <Publisher />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reproduced interleaving 2: sole keyed publisher is replaced in one commit (count 1 -> 0 -> 1) -> zero reader calls", async () => {
    function Page({ publisherKey }: { publisherKey: number }) {
      useLiveChatRooms();
      return <Publisher key={publisherKey} />;
    }

    const view = render(<Page publisherKey={1} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(<Page publisherKey={2} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reproduced interleaving 3: Activity hide then reveal with pending fetch keeps old rows and queues no extra follow-up on synchronous active invalidation", async () => {
    const revealPending = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock
      .mockResolvedValueOnce({
        rooms: [makeRoom({ id: "initial" })],
        nextCursor: null,
      })
      .mockImplementationOnce(() => {
        // Synchronous active invalidation fired during the reveal fetch before
        // the rooms-changed listener re-subscribes.
        notifyOrganizationChatRoomsChanged({ collections: ["active"] });
        return revealPending.promise;
      });

    const latest: { current: ChatRoom[] | null } = { current: null };
    function Reader() {
      latest.current = useLiveChatRooms();
      return null;
    }

    const view = render(
      <Activity mode="visible">
        <Reader />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.current?.map((r) => r.id)).toEqual(["initial"]);

    view.rerender(
      <Activity mode="hidden">
        <Reader />
      </Activity>,
    );

    view.rerender(
      <Activity mode="visible">
        <Reader />
      </Activity>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest.current?.map((r) => r.id)).toEqual(["initial"]);

    await act(async () => {
      revealPending.resolve({
        rooms: [makeRoom({ id: "revealed" })],
        nextCursor: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest.current?.map((r) => r.id)).toEqual(["revealed"]);

    view.unmount();
  });

  it("reproduced interleaving 4: A finishes, A hides, fresh B mounts with first read pending, A reveals -> A still shows its rows", async () => {
    const bPending = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock
      .mockResolvedValueOnce({
        rooms: [makeRoom({ id: "from-a" })],
        nextCursor: null,
      })
      .mockReturnValueOnce(bPending.promise);

    const seenA: { current: ChatRoom[] | null } = { current: null };
    const seenB: { current: ChatRoom[] | null } = { current: null };

    function ReaderA() {
      seenA.current = useLiveChatRooms();
      return null;
    }
    function ReaderB() {
      seenB.current = useLiveChatRooms();
      return null;
    }

    const view = render(
      <Activity mode="visible">
        <ReaderA />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seenA.current?.map((r) => r.id)).toEqual(["from-a"]);

    view.rerender(
      <>
        <Activity mode="hidden">
          <ReaderA />
        </Activity>
        <ReaderB />
      </>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenB.current).toBeNull();

    view.rerender(
      <>
        <Activity mode="visible">
          <ReaderA />
        </Activity>
        <ReaderB />
      </>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenA.current?.map((r) => r.id)).toEqual(["from-a"]);
    expect(seenB.current).toBeNull();

    view.unmount();
  });

  it("reproduced interleaving 5: new row object with same id/updatedAt/attention but new name/starredAt published before passive scope update shows the new name", () => {
    const release = registerMembershipVisibleRoomsPublisher();
    const starredAt = new Date("2026-11-24T11:00:00Z");

    publishMembershipVisibleRooms(
      [makeRoom({ id: "r1", name: "old-name", starredAt: null })],
      "org-1",
      "user-1",
    );

    const { result, rerender, unmount } = renderHook(() => useLiveChatRooms());
    expect(result.current?.[0]?.name).toBe("old-name");

    // Same-scope publish with identical id/updatedAt/attention but new name/starredAt.
    act(() => {
      publishMembershipVisibleRooms(
        [makeRoom({ id: "r1", name: "renamed-same-org", starredAt })],
        "org-1",
        "user-1",
      );
    });
    expect(result.current?.[0]?.name).toBe("renamed-same-org");
    expect(result.current?.[0]?.starredAt).toEqual(starredAt);

    // Publish a new row object for org-2 with the same id/updatedAt/attention
    // but new name and starredAt, then switch org before passive effects run.
    act(() => {
      publishMembershipVisibleRooms(
        [makeRoom({ id: "r1", name: "new-name", starredAt })],
        "org-2",
        "user-1",
      );
      sessionState.organizationId = "org-2";
      rerender();
    });

    expect(result.current?.[0]?.name).toBe("new-name");
    expect(result.current?.[0]?.starredAt).toEqual(starredAt);

    unmount();
    release();
  });

  it("reproduced interleaving 6: publish six unread, start pending optimistic read to zero, prime preview, unmount, advance 31 s -> fresh mount first render shows six", () => {
    const sixUnread = makeRoom({ id: "r1", unreadCount: 6 });
    publishMembershipVisibleRooms([sixUnread], "org-1", "user-1");
    beginRoomAttentionChange({ ...sixUnread, unreadCount: 0 }, sixUnread);

    fetchMock.mockReturnValue(new Promise(() => {}));

    // Prime preview and unmount.
    const first = renderHook(() => useLiveChatRooms());
    expect(first.result.current?.[0]?.unreadCount).toBe(0);
    first.unmount();

    // Advance past PENDING_ATTENTION_TIMEOUT_MS (30 s) with no overlay write.
    vi.advanceTimersByTime(31_000);

    let firstRenderUnread: number | undefined;
    function FreshProbe() {
      const rooms = useLiveChatRooms();
      if (firstRenderUnread === undefined) {
        firstRenderUnread = rooms?.[0]?.unreadCount;
      }
      return null;
    }

    render(<FreshProbe />).unmount();
    expect(firstRenderUnread).toBe(6);
  });

  it("reproduced interleaving 7: mirror 'old', then publish 'new' + clear snapshot + release last publisher in one batch -> keeps 'old' while takeover is pending", () => {
    const release = registerMembershipVisibleRoomsPublisher();
    publishMembershipVisibleRooms(
      [makeRoom({ id: "r1", name: "old" })],
      "org-1",
      "user-1",
    );

    fetchMock.mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderHook(() => useLiveChatRooms());
    expect(result.current?.[0]?.name).toBe("old");

    act(() => {
      publishMembershipVisibleRooms(
        [makeRoom({ id: "r1", name: "new" })],
        "org-1",
        "user-1",
      );
      clearMembershipVisibleRoomsSnapshot();
      release();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current?.[0]?.name).toBe("old");

    unmount();
  });

  it("rule 6 with two scopes: a surface switching scope drops a late answer from an entry still kept alive by another surface", async () => {
    const org1Fetch = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    } | null>();
    fetchMock
      .mockReturnValueOnce(org1Fetch.promise)
      .mockReturnValue(new Promise(() => {}));

    // Keep org-1's shared reader alive independently while switching the hook.
    const { acquireLiveChatRoomsReader } = await import(
      "./live-chat-rooms-reader"
    );
    const keepAlive = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });

    const { result, rerender, unmount } = renderHook(() =>
      useLiveChatRoomsRead(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    sessionState.organizationId = "org-2";
    rerender();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // org-1's read fails while org-1's reader is still alive (kept by keepAlive):
    // our surface is now on org-2 and must not see org-1's failure.
    await act(async () => {
      org1Fetch.resolve(null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ rooms: null, failed: false });

    unmount();
    keepAlive.release();
  });
});
