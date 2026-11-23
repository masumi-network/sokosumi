import type { Coworker, Member } from "@sokosumi/core-client";
import { MemberRole } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import { ChatControlListBridge } from "@/components/chat/chat-control-list-bridge";
import {
  FAILED_ROOM_SHELL_ROSTER,
  useRoomShellRoster,
} from "./use-room-shell-roster";

const {
  loadRoomShellRosterActionMock,
  subscribeMock,
  unsubscribeMock,
  ablyClient,
} = vi.hoisted(() => {
  const subscribeMock = vi.fn();
  const unsubscribeMock = vi.fn();
  return {
    loadRoomShellRosterActionMock: vi.fn(),
    subscribeMock,
    unsubscribeMock,
    ablyClient: {
      connection: {
        state: "connected",
        on: vi.fn(),
        off: vi.fn(),
      },
      channels: {
        get: () => ({
          subscribe: subscribeMock,
          unsubscribe: unsubscribeMock,
        }),
      },
    },
  };
});

vi.mock("ably/react", () => ({
  useAbly: () => ablyClient,
}));

vi.mock("@/app/chat/actions", () => ({
  loadRoomShellRosterAction: (...args: unknown[]) =>
    loadRoomShellRosterActionMock(...args),
}));

function makeMember(id: string, name: string): Member {
  return {
    id,
    organizationId: "org-1",
    role: MemberRole.MEMBER,
    seatAssignedAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    user: {
      id: `user-${id}`,
      name,
      email: `${name.toLowerCase()}@example.com`,
      image: null,
    },
    lastSeenAt: null,
  };
}

function makeCoworker(id: string, name: string): Coworker {
  return {
    id,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: name.toLowerCase(),
    name,
    vendor: {
      id: "vendor-1",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      name: "Vendor",
      slug: "vendor",
      logos: { light: null, dark: null },
    },
    baseURL: null,
    capabilities: ["chat"],
    image: null,
    metadata: null,
  };
}

const EMPTY_FALLBACK: RoomShellRosterPage = {
  organizationMembers: [],
  membersLoadFailed: false,
  coworkers: [],
  sokoBots: [],
};

function controlHandlerFor(eventName: string) {
  const call = subscribeMock.mock.calls.find((args) => args[0] === eventName);
  return call?.[1] as ((message: { data: unknown }) => void) | undefined;
}

function createWrapper(queryClient: QueryClient, withControlBridge = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {withControlBridge ? (
          <ChatControlListBridge currentUserId="user-1" />
        ) : null}
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useRoomShellRoster", () => {
  beforeEach(() => {
    loadRoomShellRosterActionMock.mockReset();
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
  });

  it("uses the server roster promise as the query's first result without calling the action", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const deferred = Promise.withResolvers<RoomShellRosterPage>();
    const alice = makeMember("m-1", "Alice");
    const agent = makeCoworker("c-1", "Agent");

    const { result } = renderHook(
      () =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          organizationIdForRoster: "org-1",
          rosterPromise: deferred.promise,
          fallback: EMPTY_FALLBACK,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.ready).toBe(false);
    expect(result.current.organizationMembers).toEqual([]);
    expect(result.current.membersLoadFailed).toBe(false);

    await act(async () => {
      deferred.resolve({
        organizationMembers: [alice],
        membersLoadFailed: false,
        coworkers: [agent],
        sokoBots: [],
      });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.organizationMembers).toEqual([alice]);
    expect(result.current.coworkers).toEqual([agent]);
    expect(result.current.membersLoadFailed).toBe(false);
    expect(loadRoomShellRosterActionMock).not.toHaveBeenCalled();
  });

  it("settles a rejected roster promise to the failed state, never leaving it pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const deferred = Promise.withResolvers<RoomShellRosterPage>();

    const { result } = renderHook(
      () =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          organizationIdForRoster: "org-1",
          rosterPromise: deferred.promise,
          fallback: EMPTY_FALLBACK,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.ready).toBe(false);

    await act(async () => {
      deferred.reject(new Error("coworkers unavailable"));
      await deferred.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.organizationMembers).toEqual(
      FAILED_ROOM_SHELL_ROSTER.organizationMembers,
    );
    expect(result.current.membersLoadFailed).toBe(true);
    expect(result.current.coworkers).toEqual([]);
    expect(result.current.sokoBots).toEqual([]);
  });

  it("refreshes the roster when a chat_rooms_changed event for the room arrives over Ably", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const alice = makeMember("m-1", "Alice");
    const bob = makeMember("m-2", "Bob");
    const initialPromise = Promise.resolve<RoomShellRosterPage>({
      organizationMembers: [alice],
      membersLoadFailed: false,
      coworkers: [],
      sokoBots: [],
    });

    loadRoomShellRosterActionMock.mockResolvedValueOnce({
      ok: true,
      value: {
        organizationMembers: [alice, bob],
        membersLoadFailed: false,
        coworkers: [],
        sokoBots: [],
      },
    });

    const { result } = renderHook(
      () =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          organizationIdForRoster: "org-1",
          rosterPromise: initialPromise,
          fallback: EMPTY_FALLBACK,
        }),
      { wrapper: createWrapper(queryClient, true) },
    );

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice]);
    });

    // Events for another room or non-active collections must not refetch.
    act(() => {
      controlHandlerFor("chat_rooms_changed")?.({
        data: {
          collections: ["active"],
          roomId: "room-other",
          at: "2026-09-09T12:00:00.000Z",
        },
      });
      controlHandlerFor("chat_rooms_changed")?.({
        data: {
          collections: ["archived"],
          roomId: "room-1",
          at: "2026-09-09T12:00:01.000Z",
        },
      });
    });
    expect(loadRoomShellRosterActionMock).not.toHaveBeenCalled();

    // A matching roster event invalidates and refreshes through the action.
    act(() => {
      controlHandlerFor("chat_rooms_changed")?.({
        data: {
          collections: ["active"],
          roomId: "room-1",
          at: "2026-09-09T12:00:02.000Z",
        },
      });
    });

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice, bob]);
    });
    expect(loadRoomShellRosterActionMock).toHaveBeenCalledTimes(1);
    expect(loadRoomShellRosterActionMock).toHaveBeenCalledWith("org-1");
  });

  it("keeps the newer roster when a roster event arrives while the initial server promise is still in flight", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const staleInitial = Promise.withResolvers<RoomShellRosterPage>();
    const freshRefetch = Promise.withResolvers<{
      ok: true;
      value: RoomShellRosterPage;
    }>();
    const alice = makeMember("m-1", "Alice");
    const bob = makeMember("m-2", "Bob");

    loadRoomShellRosterActionMock.mockReturnValueOnce(freshRefetch.promise);

    const { result } = renderHook(
      () =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          organizationIdForRoster: "org-1",
          rosterPromise: staleInitial.promise,
          fallback: EMPTY_FALLBACK,
        }),
      { wrapper: createWrapper(queryClient, true) },
    );

    expect(result.current.ready).toBe(false);

    // Roster event arrives before the initial server promise settles.
    act(() => {
      controlHandlerFor("chat_rooms_changed")?.({
        data: {
          collections: ["active"],
          roomId: "room-1",
          at: "2026-09-09T12:00:02.000Z",
        },
      });
    });

    await waitFor(() => {
      expect(loadRoomShellRosterActionMock).toHaveBeenCalledTimes(1);
    });

    // Fresh refetch settles first with [Alice, Bob].
    await act(async () => {
      freshRefetch.resolve({
        ok: true,
        value: {
          organizationMembers: [alice, bob],
          membersLoadFailed: false,
          coworkers: [],
          sokoBots: [],
        },
      });
      await freshRefetch.promise;
    });

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice, bob]);
    });

    // Stale initial server promise resolves late with [Alice] only — must not overwrite.
    await act(async () => {
      staleInitial.resolve({
        organizationMembers: [alice],
        membersLoadFailed: false,
        coworkers: [],
        sokoBots: [],
      });
      await staleInitial.promise;
    });

    expect(result.current.organizationMembers).toEqual([alice, bob]);
  });

  it("drops the previous workspace's roster immediately on workspace switch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const alice = makeMember("m-1", "Alice");
    const orgAPromise = Promise.resolve<RoomShellRosterPage>({
      organizationMembers: [alice],
      membersLoadFailed: false,
      coworkers: [],
      sokoBots: [],
    });
    const orgBDeferred = Promise.withResolvers<RoomShellRosterPage>();

    const { result, rerender } = renderHook(
      ({
        workspaceId,
        rosterPromise,
      }: {
        workspaceId: string | null;
        rosterPromise: Promise<RoomShellRosterPage>;
      }) =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId,
          roomId: "room-1",
          organizationIdForRoster: workspaceId,
          rosterPromise,
          fallback: EMPTY_FALLBACK,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: {
          workspaceId: "org-a" as string | null,
          rosterPromise: orgAPromise,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice]);
    });

    rerender({
      workspaceId: "org-b",
      rosterPromise: orgBDeferred.promise,
    });

    expect(result.current.ready).toBe(false);
    expect(result.current.organizationMembers).toEqual([]);
  });
});
