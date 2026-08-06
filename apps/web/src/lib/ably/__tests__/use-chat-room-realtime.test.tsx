import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("useChatRoomRealtime", () => {
  beforeEach(() => {
    authorizeMock.mockReset();
    getMock.mockReset();
    channelsByName.clear();
    authorizeMock.mockResolvedValue(undefined);
    getMock.mockImplementation((name: string) => channelFor(name));
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
