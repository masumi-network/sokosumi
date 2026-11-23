import type { ChatRoomMessage } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { RoomTranscriptCache } from "@/app/chat/utils/room-transcript-cache";
import {
  FAILED_ROOM_MESSAGE_PAGE,
  type RoomMessagePage,
  useRoomInitialMessages,
} from "./use-room-initial-messages";

function makeMessage(id: string, content: string): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useRoomInitialMessages", () => {
  it("resolves a Next Flight thenable whose .then returns undefined, preserving firstUnreadMessageId", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const flight = createFlightThenable<RoomMessagePage>();
    const m1 = makeMessage("m1", "Hello");

    const { result } = renderHook(
      () =>
        useRoomInitialMessages({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          messagesPromise: flight.thenable,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.pending).toBe(true);
    expect(result.current.settledPage).toBeUndefined();

    act(() => {
      flight.resolve({
        messages: [m1],
        nextCursor: "cursor-1",
        failed: false,
        firstUnreadMessageId: "m1",
      });
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.settledPage).toEqual({
      messages: [m1],
      nextCursor: "cursor-1",
      failed: false,
      firstUnreadMessageId: "m1",
    });
    expect(result.current.settledPromiseId).toBeTypeOf("number");
  });

  it("settles a rejected history promise to the failed state, never leaving it pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const flight = createFlightThenable<RoomMessagePage>();

    const { result } = renderHook(
      () =>
        useRoomInitialMessages({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          messagesPromise: flight.thenable,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.pending).toBe(true);

    act(() => {
      flight.reject(new Error("history unavailable"));
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.settledPage).toEqual(FAILED_ROOM_MESSAGE_PAGE);
  });

  it("replaces on a new server promise and ignores an older promise resolving later", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const olderPromise = Promise.withResolvers<RoomMessagePage>();
    const newerPromise = Promise.withResolvers<RoomMessagePage>();
    const oldMsg = makeMessage("m1", "Old");
    const newMsg = makeMessage("m2", "New");

    const { result, rerender } = renderHook(
      ({ messagesPromise }: { messagesPromise: Promise<RoomMessagePage> }) =>
        useRoomInitialMessages({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          messagesPromise,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { messagesPromise: olderPromise.promise },
      },
    );

    expect(result.current.pending).toBe(true);

    rerender({ messagesPromise: newerPromise.promise });

    await act(async () => {
      newerPromise.resolve({
        messages: [newMsg],
        nextCursor: null,
        failed: false,
      });
      await newerPromise.promise;
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.settledPage?.messages).toEqual([newMsg]);

    // Older promise resolves late with stale data — must not overwrite the newer page.
    await act(async () => {
      olderPromise.resolve({
        messages: [oldMsg],
        nextCursor: null,
        failed: false,
      });
      await olderPromise.promise;
    });

    expect(result.current.settledPage?.messages).toEqual([newMsg]);
  });

  it("keeps non-pending state during a same-room refresh promise and drops previous room data on room switch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const m1 = makeMessage("m1", "First");
    const m2 = makeMessage("m2", "Refreshed");
    const firstPromise = Promise.resolve<RoomMessagePage>({
      messages: [m1],
      nextCursor: null,
      failed: false,
    });
    const refreshDeferred = Promise.withResolvers<RoomMessagePage>();

    const { result, rerender } = renderHook(
      ({
        roomId,
        messagesPromise,
      }: {
        roomId: string;
        messagesPromise: Promise<RoomMessagePage>;
      }) =>
        useRoomInitialMessages({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId,
          messagesPromise,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { roomId: "room-1", messagesPromise: firstPromise },
      },
    );

    await waitFor(() => {
      expect(result.current.settledPage?.messages).toEqual([m1]);
    });
    expect(result.current.pending).toBe(false);
    const firstPromiseId = result.current.settledPromiseId;

    // Same-room refresh delivers a pending promise: stays non-pending via placeholderData,
    // while settledPage stays undefined until the new promise resolves.
    rerender({ roomId: "room-1", messagesPromise: refreshDeferred.promise });
    expect(result.current.pending).toBe(false);
    expect(result.current.page?.messages).toEqual([m1]);
    expect(result.current.settledPage).toBeUndefined();

    await act(async () => {
      refreshDeferred.resolve({
        messages: [m2],
        nextCursor: null,
        failed: false,
      });
      await refreshDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.settledPage?.messages).toEqual([m2]);
    });
    expect(result.current.settledPromiseId).not.toBe(firstPromiseId);

    // Switching to another room drops the previous room's page while pending.
    const otherRoomDeferred = Promise.withResolvers<RoomMessagePage>();
    rerender({ roomId: "room-2", messagesPromise: otherRoomDeferred.promise });
    expect(result.current.pending).toBe(true);
    expect(result.current.page).toBeUndefined();
    expect(result.current.settledPage).toBeUndefined();
  });

  it("drops previous workspace data while pending and reads a fresh server promise on workspace return", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mA = makeMessage("m-a", "Org A");
    const mAReturn = makeMessage("m-a-2", "Org A Fresh");
    const orgAFirst = Promise.resolve<RoomMessagePage>({
      messages: [mA],
      nextCursor: null,
      failed: false,
    });
    const orgBDeferred = Promise.withResolvers<RoomMessagePage>();
    const orgAReturn = Promise.resolve<RoomMessagePage>({
      messages: [mAReturn],
      nextCursor: null,
      failed: false,
    });

    const { result, rerender } = renderHook(
      ({
        workspaceId,
        messagesPromise,
      }: {
        workspaceId: string | null;
        messagesPromise: Promise<RoomMessagePage>;
      }) =>
        useRoomInitialMessages({
          currentUserId: "user-1",
          workspaceId,
          roomId: "room-1",
          messagesPromise,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: {
          workspaceId: "org-a" as string | null,
          messagesPromise: orgAFirst,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.settledPage?.messages).toEqual([mA]);
    });

    rerender({ workspaceId: "org-b", messagesPromise: orgBDeferred.promise });
    expect(result.current.pending).toBe(true);
    expect(result.current.page).toBeUndefined();

    rerender({ workspaceId: "org-a", messagesPromise: orgAReturn });
    await waitFor(() => {
      expect(result.current.settledPage?.messages).toEqual([mAReturn]);
    });
  });

  it("runs even when RoomTranscriptCache registered disabled defaults on anyTranscript()", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // RoomTranscriptCache calls setQueryDefaults(anyTranscript(), { enabled: false }).
    const cache = new RoomTranscriptCache(queryClient, "user-1", "org-1");
    const m1 = makeMessage("m1", "Streamed");
    const promise = Promise.resolve<RoomMessagePage>({
      messages: [m1],
      nextCursor: null,
      failed: false,
    });

    const { result } = renderHook(
      () =>
        useRoomInitialMessages({
          currentUserId: "user-1",
          workspaceId: "org-1",
          roomId: "room-1",
          messagesPromise: promise,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.settledPage?.messages).toEqual([m1]);
    });
    cache.clear();
  });
});
