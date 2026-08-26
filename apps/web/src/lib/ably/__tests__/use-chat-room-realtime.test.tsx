import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, getMock, channelsByName, ablyClient } = vi.hoisted(
  () => {
    const authorize = vi.fn();
    const get = vi.fn();
    return {
      authorizeMock: authorize,
      getMock: get,
      channelsByName: new Map<
        string,
        {
          name: string;
          subscribe: ReturnType<typeof vi.fn>;
          unsubscribe: ReturnType<typeof vi.fn>;
          detach: ReturnType<typeof vi.fn>;
        }
      >(),
      // Stable client identity — new object each useAbly() would full-reset attach.
      ablyClient: {
        auth: { authorize },
        channels: { get },
      },
    };
  },
);

vi.mock("ably/react", () => ({
  useAbly: () => ablyClient,
}));

import { useChatRoomRealtime } from "../use-chat-room-realtime";

function channelFor(name: string) {
  let channel = channelsByName.get(name);
  if (!channel) {
    channel = {
      name,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      detach: vi.fn(),
    };
    channelsByName.set(name, channel);
  }
  return channel;
}

function tokenWithRooms(...roomIds: string[]) {
  const capability: Record<string, string[]> = {
    "notifications:all:user_1": ["subscribe"],
    "chat_control:user_user_1": ["subscribe"],
  };
  for (const roomId of roomIds) {
    capability[`chat_rooms:room_${roomId}`] = ["subscribe"];
  }
  return { capability: JSON.stringify(capability) };
}

function controlSubscribeHandler() {
  const control = channelFor("chat_control:user_user_1");
  const call = control.subscribe.mock.calls.find(
    (args) => args[0] === "chat_membership_revoked",
  );
  return call?.[1] as ((message: { data: unknown }) => void) | undefined;
}

describe("useChatRoomRealtime", () => {
  beforeEach(() => {
    authorizeMock.mockReset();
    getMock.mockReset();
    channelsByName.clear();
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-b"));
    getMock.mockImplementation((name: string) => channelFor(name));
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("authorizes then subscribes to each membership room channel", async () => {
    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-b", "room-a"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith("chat_rooms:room_room-a");
      expect(getMock).toHaveBeenCalledWith("chat_rooms:room_room-b");
      expect(channelFor("chat_rooms:room_room-a").subscribe).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledWith("chat_room_pinned_message", expect.any(Function));
    });
  });

  it("subscribes to the user chat control channel for revoke signals", async () => {
    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("chat_control:user_user_1");
      expect(
        channelFor("chat_control:user_user_1").subscribe,
      ).toHaveBeenCalledWith("chat_membership_revoked", expect.any(Function));
    });
  });

  it("does not subscribe when authorize fails", async () => {
    const onError = vi.fn();
    authorizeMock.mockRejectedValue(new Error("token refresh failed"));

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
        onError,
      }),
    );

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalled();
    });
    // Control channel still attaches; room channels do not.
    expect(getMock).toHaveBeenCalledWith("chat_control:user_user_1");
    expect(getMock).not.toHaveBeenCalledWith("chat_rooms:room_room-a");
  });

  it("on membership change, only detaches removed and subscribes added rooms", async () => {
    authorizeMock.mockResolvedValue(
      tokenWithRooms("room-a", "room-b", "room-c"),
    );

    const { rerender } = renderHook(
      ({ roomIds }: { roomIds: string[] }) =>
        useChatRoomRealtime({
          roomIds,
          currentUserId: "user_1",
        }),
      { initialProps: { roomIds: ["room-a", "room-b"] } },
    );

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-a").subscribe,
      ).toHaveBeenCalledTimes(2);
      expect(
        channelFor("chat_rooms:room_room-b").subscribe,
      ).toHaveBeenCalledTimes(2);
    });

    authorizeMock.mockClear();
    getMock.mockClear();
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-c"));

    rerender({ roomIds: ["room-a", "room-c"] });

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
      // left b
      expect(
        channelFor("chat_rooms:room_room-b").unsubscribe,
      ).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();
      // joined c
      expect(getMock).toHaveBeenCalledWith("chat_rooms:room_room-c");
      expect(
        channelFor("chat_rooms:room_room-c").subscribe,
      ).toHaveBeenCalledTimes(2);
    });

    // stable a — no second subscribe
    expect(
      channelFor("chat_rooms:room_room-a").subscribe,
    ).toHaveBeenCalledTimes(2);
    expect(
      channelFor("chat_rooms:room_room-a").unsubscribe,
    ).not.toHaveBeenCalled();
  });

  it("on control revoke, detaches the room immediately and re-authorizes", async () => {
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-b"));
    const onMembershipRevoked = vi.fn();

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a", "room-b"],
        currentUserId: "user_1",
        onMembershipRevoked,
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
      expect(controlSubscribeHandler()).toBeTypeOf("function");
    });

    authorizeMock.mockClear();
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a"));

    act(() => {
      controlSubscribeHandler()?.({
        data: {
          roomId: "room-b",
          reason: "removed",
          at: "2026-08-06T12:00:00.000Z",
        },
      });
    });

    expect(channelFor("chat_rooms:room_room-b").unsubscribe).toHaveBeenCalled();
    expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();
    expect(onMembershipRevoked).toHaveBeenCalledWith({
      roomId: "room-b",
      reason: "removed",
      at: "2026-08-06T12:00:00.000Z",
    });

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not re-attach a revoked room when a stale authorize resolves late", async () => {
    let resolveStaleAuth: ((value: unknown) => void) | undefined;
    const staleAuth = new Promise((resolve) => {
      resolveStaleAuth = resolve;
    });

    authorizeMock
      .mockResolvedValueOnce(tokenWithRooms("room-a", "room-b"))
      .mockImplementationOnce(() => staleAuth)
      .mockResolvedValue(tokenWithRooms("room-a"));

    const { rerender } = renderHook(
      ({ roomIds }: { roomIds: string[] }) =>
        useChatRoomRealtime({
          roomIds,
          currentUserId: "user_1",
        }),
      { initialProps: { roomIds: ["room-a", "room-b"] } },
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
      expect(controlSubscribeHandler()).toBeTypeOf("function");
    });

    // Start a membership-driven re-auth that will resolve with a stale token.
    act(() => {
      rerender({ roomIds: ["room-a", "room-b", "room-c"] });
    });

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(2);
    });

    act(() => {
      controlSubscribeHandler()?.({
        data: {
          roomId: "room-b",
          reason: "removed",
          at: "2026-08-06T12:00:00.000Z",
        },
      });
    });

    expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();

    const subscribeCountAfterDetach = channelFor("chat_rooms:room_room-b")
      .subscribe.mock.calls.length;

    // Stale token still includes room-b; generation bump must discard it.
    await act(async () => {
      resolveStaleAuth?.(tokenWithRooms("room-a", "room-b", "room-c"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      // Fresh authorize after revoke must have run.
      expect(authorizeMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    expect(
      channelFor("chat_rooms:room_room-b").subscribe.mock.calls.length,
    ).toBe(subscribeCountAfterDetach);
  });

  it("detaches rooms dropped from token capability even when props stay stale", async () => {
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-b"));

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a", "room-b"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
    });

    authorizeMock.mockResolvedValue(tokenWithRooms("room-a"));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(
        channelFor("chat_rooms:room_room-b").unsubscribe,
      ).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();
    });

    // room-a stays attached; no re-subscribe
    expect(
      channelFor("chat_rooms:room_room-a").subscribe,
    ).toHaveBeenCalledTimes(2);
    expect(
      channelFor("chat_rooms:room_room-a").unsubscribe,
    ).not.toHaveBeenCalled();
  });

  it("does not re-authorize on a timer while mounted (control + focus/visibility only)", async () => {
    vi.useFakeTimers();
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a"));

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(authorizeMock).toHaveBeenCalledTimes(1);

    // Former 120s interval and multi-minute span must not mint again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(authorizeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(authorizeMock).toHaveBeenCalledTimes(1);
  });

  it("re-authorizes when the document becomes visible", async () => {
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a"));

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps prior channels when a later authorize fails", async () => {
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a"));

    const onError = vi.fn();
    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
        onError,
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-a").subscribe).toHaveBeenCalled();
    });

    authorizeMock.mockRejectedValue(new Error("token refresh failed"));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    expect(
      channelFor("chat_rooms:room_room-a").unsubscribe,
    ).not.toHaveBeenCalled();
    expect(channelFor("chat_rooms:room_room-a").detach).not.toHaveBeenCalled();
  });

  it("falls back to prop roomIds when token capability is unparseable", async () => {
    authorizeMock.mockResolvedValue({ capability: "not-json" });

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a", "room-b"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("chat_rooms:room_room-a");
      expect(getMock).toHaveBeenCalledWith("chat_rooms:room_room-b");
      expect(channelFor("chat_rooms:room_room-a").subscribe).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
    });
  });

  it("does not re-attach a revoked room when capability falls back to props", async () => {
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-b"));

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a", "room-b"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
      expect(controlSubscribeHandler()).toBeTypeOf("function");
    });

    // Post-revoke authorize returns unparseable capability so sync would
    // otherwise fall back to stale prop roomIds including room-b.
    authorizeMock.mockClear();
    authorizeMock.mockResolvedValue({ capability: "not-json" });
    getMock.mockClear();
    channelFor("chat_rooms:room_room-b").subscribe.mockClear();

    act(() => {
      controlSubscribeHandler()?.({
        data: {
          roomId: "room-b",
          reason: "removed",
          at: "2026-08-06T12:00:00.000Z",
        },
      });
    });

    expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
    });

    expect(getMock).not.toHaveBeenCalledWith("chat_rooms:room_room-b");
    expect(
      channelFor("chat_rooms:room_room-b").subscribe,
    ).not.toHaveBeenCalled();
  });

  it("detaches all chat rooms when token grants no room channels", async () => {
    authorizeMock.mockResolvedValue(tokenWithRooms("room-a", "room-b"));

    renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a", "room-b"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-a").subscribe).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
    });

    authorizeMock.mockResolvedValue(tokenWithRooms());

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-a").detach).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();
    });
  });

  it("detaches all channels on unmount", async () => {
    const { unmount } = renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a", "room-b"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-a").subscribe).toHaveBeenCalled();
      expect(channelFor("chat_rooms:room_room-b").subscribe).toHaveBeenCalled();
    });

    act(() => {
      unmount();
    });

    expect(channelFor("chat_rooms:room_room-a").unsubscribe).toHaveBeenCalled();
    expect(channelFor("chat_rooms:room_room-a").detach).toHaveBeenCalled();
    expect(channelFor("chat_rooms:room_room-b").unsubscribe).toHaveBeenCalled();
    expect(channelFor("chat_rooms:room_room-b").detach).toHaveBeenCalled();
    expect(
      channelFor("chat_control:user_user_1").unsubscribe,
    ).toHaveBeenCalled();
    expect(channelFor("chat_control:user_user_1").detach).toHaveBeenCalled();
  });

  it("does not surface attach/detach race rejections on unmount", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { unmount } = renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(channelFor("chat_rooms:room_room-a").subscribe).toHaveBeenCalled();
    });

    channelFor("chat_rooms:room_room-a").detach.mockRejectedValue(
      new Error("Attach request superseded by a subsequent detach request"),
    );
    channelFor("chat_control:user_user_1").detach.mockRejectedValue(
      new Error("Detach request superseded by a subsequent attach request"),
    );

    act(() => {
      unmount();
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalledWith(
      "Ably channel detach failed",
      expect.anything(),
    );
    consoleError.mockRestore();
  });
});
