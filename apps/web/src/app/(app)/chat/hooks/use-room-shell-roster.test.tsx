import type { Coworker, Member } from "@sokosumi/core-client";
import { MemberRole } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import {
  FAILED_ROOM_SHELL_ROSTER,
  useRoomShellRoster,
} from "./use-room-shell-roster";

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

/**
 * Mirrors a Next.js Flight streamed thenable: `.then` attaches callbacks and
 * returns `undefined` (not a chained Promise), and there is no `.catch` method.
 */
function createFlightThenable<T>() {
  const onFulfilledList: Array<(value: T) => void> = [];
  const onRejectedList: Array<(reason: unknown) => void> = [];
  let state:
    | { status: "pending" }
    | { status: "fulfilled"; value: T }
    | { status: "rejected"; reason: unknown } = { status: "pending" };

  const thenable = {
    then(
      onFulfilled?: ((value: T) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      if (state.status === "fulfilled") {
        onFulfilled?.(state.value);
      } else if (state.status === "rejected") {
        onRejected?.(state.reason);
      } else {
        if (onFulfilled) onFulfilledList.push(onFulfilled);
        if (onRejected) onRejectedList.push(onRejected);
      }
      return undefined;
    },
  } as unknown as Promise<T>;

  return {
    thenable,
    resolve(value: T) {
      if (state.status !== "pending") return;
      state = { status: "fulfilled", value };
      for (const fn of onFulfilledList) fn(value);
    },
    reject(reason: unknown) {
      if (state.status !== "pending") return;
      state = { status: "rejected", reason };
      for (const fn of onRejectedList) fn(reason);
    },
  };
}

const EMPTY_FALLBACK: RoomShellRosterPage = {
  organizationMembers: [],
  membersLoadFailed: false,
  coworkers: [],
  sokoBots: [],
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useRoomShellRoster", () => {
  it("resolves a Next Flight thenable whose .then returns undefined", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const flight = createFlightThenable<RoomShellRosterPage>();
    const alice = makeMember("m-1", "Alice");
    const agent = makeCoworker("c-1", "Agent");

    const { result } = renderHook(
      () =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          rosterPromise: flight.thenable,
          fallback: EMPTY_FALLBACK,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.ready).toBe(false);
    expect(result.current.organizationMembers).toEqual([]);
    expect(result.current.membersLoadFailed).toBe(false);

    act(() => {
      flight.resolve({
        organizationMembers: [alice],
        membersLoadFailed: false,
        coworkers: [agent],
        sokoBots: [],
      });
    });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.organizationMembers).toEqual([alice]);
    expect(result.current.coworkers).toEqual([agent]);
    expect(result.current.membersLoadFailed).toBe(false);
  });

  it("settles a rejected roster promise to the failed state, never leaving it pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const flight = createFlightThenable<RoomShellRosterPage>();

    const { result } = renderHook(
      () =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          rosterPromise: flight.thenable,
          fallback: EMPTY_FALLBACK,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.ready).toBe(false);

    act(() => {
      flight.reject(new Error("coworkers unavailable"));
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

  it("replaces the roster on a new server promise and ignores an older promise resolving later", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const olderPromise = Promise.withResolvers<RoomShellRosterPage>();
    const newerPromise = Promise.withResolvers<RoomShellRosterPage>();
    const alice = makeMember("m-1", "Alice");
    const bob = makeMember("m-2", "Bob");

    const { result, rerender } = renderHook(
      ({ rosterPromise }: { rosterPromise: Promise<RoomShellRosterPage> }) =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          rosterPromise,
          fallback: EMPTY_FALLBACK,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { rosterPromise: olderPromise.promise },
      },
    );

    expect(result.current.ready).toBe(false);

    // Same-room RSC refresh delivers a newer promise before the older one settles.
    rerender({ rosterPromise: newerPromise.promise });

    await act(async () => {
      newerPromise.resolve({
        organizationMembers: [alice, bob],
        membersLoadFailed: false,
        coworkers: [],
        sokoBots: [],
      });
      await newerPromise.promise;
    });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.organizationMembers).toEqual([alice, bob]);

    // Older promise resolves late with stale data — must not overwrite the newer roster.
    await act(async () => {
      olderPromise.resolve({
        organizationMembers: [alice],
        membersLoadFailed: false,
        coworkers: [],
        sokoBots: [],
      });
      await olderPromise.promise;
    });

    expect(result.current.organizationMembers).toEqual([alice, bob]);
  });

  it("keeps the settled roster while a same-room refresh promise is pending until the new roster arrives", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const alice = makeMember("m-1", "Alice");
    const bob = makeMember("m-2", "Bob");
    const firstPromise = Promise.resolve<RoomShellRosterPage>({
      organizationMembers: [alice],
      membersLoadFailed: false,
      coworkers: [],
      sokoBots: [],
    });
    const refreshDeferred = Promise.withResolvers<RoomShellRosterPage>();

    const { result, rerender } = renderHook(
      ({
        roomId,
        rosterPromise,
      }: {
        roomId: string;
        rosterPromise: Promise<RoomShellRosterPage>;
      }) =>
        useRoomShellRoster({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId,
          rosterPromise,
          fallback: EMPTY_FALLBACK,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { roomId: "room-1", rosterPromise: firstPromise },
      },
    );

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice]);
    });
    expect(result.current.ready).toBe(true);

    // Same-room RSC refresh delivers a pending promise: roster must stay [Alice].
    rerender({ roomId: "room-1", rosterPromise: refreshDeferred.promise });
    expect(result.current.ready).toBe(true);
    expect(result.current.organizationMembers).toEqual([alice]);

    // Once the refresh settles, roster updates to [Bob].
    await act(async () => {
      refreshDeferred.resolve({
        organizationMembers: [bob],
        membersLoadFailed: false,
        coworkers: [],
        sokoBots: [],
      });
      await refreshDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([bob]);
    });

    // Switching to another room drops the previous room's roster while pending.
    const otherRoomDeferred = Promise.withResolvers<RoomShellRosterPage>();
    rerender({ roomId: "room-2", rosterPromise: otherRoomDeferred.promise });
    expect(result.current.ready).toBe(false);
    expect(result.current.organizationMembers).toEqual([]);
  });

  it("reads a new server promise when returning to a previously cached workspace and drops the prior workspace while pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const alice = makeMember("m-1", "Alice");
    const bob = makeMember("m-2", "Bob");
    const orgAFirst = Promise.resolve<RoomShellRosterPage>({
      organizationMembers: [alice],
      membersLoadFailed: false,
      coworkers: [],
      sokoBots: [],
    });
    const orgBDeferred = Promise.withResolvers<RoomShellRosterPage>();
    const orgAReturn = Promise.resolve<RoomShellRosterPage>({
      organizationMembers: [alice, bob],
      membersLoadFailed: false,
      coworkers: [],
      sokoBots: [],
    });

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
          rosterPromise,
          fallback: EMPTY_FALLBACK,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: {
          workspaceId: "org-a" as string | null,
          rosterPromise: orgAFirst,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice]);
    });

    // Switch to org-b: org-a's roster is dropped immediately while org-b is pending.
    rerender({
      workspaceId: "org-b",
      rosterPromise: orgBDeferred.promise,
    });
    expect(result.current.ready).toBe(false);
    expect(result.current.organizationMembers).toEqual([]);

    // Return to org-a with a fresh server promise: reads the new promise instead of stale cache.
    rerender({
      workspaceId: "org-a",
      rosterPromise: orgAReturn,
    });

    await waitFor(() => {
      expect(result.current.organizationMembers).toEqual([alice, bob]);
    });
  });
});
