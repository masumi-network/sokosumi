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

import {
  CHAT_ROOM_CAP_REAUTH_INTERVAL_MS,
  useChatRoomRealtime,
} from "../use-chat-room-realtime";

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
  };
  for (const roomId of roomIds) {
    capability[`chat_rooms:room_${roomId}`] = ["subscribe"];
  }
  return { capability: JSON.stringify(capability) };
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
    expect(getMock).not.toHaveBeenCalled();
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
      ).toHaveBeenCalledTimes(1);
      expect(
        channelFor("chat_rooms:room_room-b").subscribe,
      ).toHaveBeenCalledTimes(1);
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
      ).toHaveBeenCalledTimes(1);
    });

    // stable a — no second subscribe
    expect(
      channelFor("chat_rooms:room_room-a").subscribe,
    ).toHaveBeenCalledTimes(1);
    expect(
      channelFor("chat_rooms:room_room-a").unsubscribe,
    ).not.toHaveBeenCalled();
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
    ).toHaveBeenCalledTimes(1);
    expect(
      channelFor("chat_rooms:room_room-a").unsubscribe,
    ).not.toHaveBeenCalled();
  });

  it("re-authorizes on the cap refresh interval while mounted", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_ROOM_CAP_REAUTH_INTERVAL_MS);
    });
    expect(authorizeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_ROOM_CAP_REAUTH_INTERVAL_MS);
    });
    expect(authorizeMock).toHaveBeenCalledTimes(3);
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
  });
});
