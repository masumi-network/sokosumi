import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, getMock, subscribeMock, unsubscribeMock, detachMock } =
  vi.hoisted(() => ({
    authorizeMock: vi.fn(),
    getMock: vi.fn(),
    subscribeMock: vi.fn(),
    unsubscribeMock: vi.fn(),
    detachMock: vi.fn(),
  }));

vi.mock("ably/react", () => ({
  useAbly: () => ({
    auth: { authorize: authorizeMock },
    channels: { get: getMock },
  }),
}));

import { useChatRoomRealtime } from "../use-chat-room-realtime";

describe("useChatRoomRealtime", () => {
  beforeEach(() => {
    authorizeMock.mockReset();
    getMock.mockReset();
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    detachMock.mockReset();
    authorizeMock.mockResolvedValue(undefined);
    getMock.mockImplementation(() => ({
      subscribe: subscribeMock,
      unsubscribe: unsubscribeMock,
      detach: detachMock,
    }));
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
      expect(subscribeMock).toHaveBeenCalledTimes(2);
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
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("detaches channels on unmount", async () => {
    const { unmount } = renderHook(() =>
      useChatRoomRealtime({
        roomIds: ["room-a"],
        currentUserId: "user_1",
      }),
    );

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      unmount();
    });

    expect(unsubscribeMock).toHaveBeenCalled();
    expect(detachMock).toHaveBeenCalled();
  });
});
