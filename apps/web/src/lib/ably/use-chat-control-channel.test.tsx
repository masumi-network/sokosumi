import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribeMock, unsubscribeMock, connectionListeners } = vi.hoisted(
  () => ({
    subscribeMock: vi.fn(),
    unsubscribeMock: vi.fn(),
    connectionListeners: new Set<() => void>(),
  }),
);

vi.mock("ably/react", () => ({
  useAbly: () => ({
    connection: {
      state: "connected",
      on: (listener: () => void) => connectionListeners.add(listener),
      off: (listener: () => void) => connectionListeners.delete(listener),
    },
    channels: {
      get: () => ({ subscribe: subscribeMock, unsubscribe: unsubscribeMock }),
    },
  }),
}));

import { useChatControlChannel } from "./use-chat-control-channel";

function handlerFor(eventName: string) {
  const call = subscribeMock.mock.calls.find((args) => args[0] === eventName);
  return call?.[1] as ((message: { data: unknown }) => void) | undefined;
}

describe("useChatControlChannel", () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    connectionListeners.clear();
  });

  it("routes revoke and rooms-changed events to their handlers", () => {
    const onRevoked = vi.fn();
    const onRoomsChanged = vi.fn();
    renderHook(() =>
      useChatControlChannel({
        currentUserId: "user_1",
        onRevoked,
        onRoomsChanged,
      }),
    );

    act(() => {
      handlerFor("chat_membership_revoked")?.({
        data: {
          roomId: "room-a",
          reason: "removed",
          at: "2026-09-09T12:00:00.000Z",
        },
      });
      handlerFor("chat_rooms_changed")?.({
        data: {
          collections: ["archived", "active"],
          roomId: "room-a",
          at: "2026-09-09T12:00:00.000Z",
        },
      });
    });

    expect(onRevoked).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-a", reason: "removed" }),
    );
    expect(onRoomsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ collections: ["archived", "active"] }),
    );
  });

  it("ignores a malformed rooms-changed payload", () => {
    const onRoomsChanged = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderHook(() =>
      useChatControlChannel({
        currentUserId: "user_1",
        onRevoked: vi.fn(),
        onRoomsChanged,
      }),
    );

    act(() => {
      handlerFor("chat_rooms_changed")?.({ data: { collections: [] } });
    });

    expect(onRoomsChanged).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not subscribe without a current user id", () => {
    renderHook(() =>
      useChatControlChannel({
        currentUserId: "",
        onRevoked: vi.fn(),
        onRoomsChanged: vi.fn(),
      }),
    );
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("unsubscribes both events on unmount", () => {
    const { unmount } = renderHook(() =>
      useChatControlChannel({
        currentUserId: "user_1",
        onRevoked: vi.fn(),
        onRoomsChanged: vi.fn(),
      }),
    );
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledWith(
      "chat_membership_revoked",
      expect.any(Function),
    );
    expect(unsubscribeMock).toHaveBeenCalledWith(
      "chat_rooms_changed",
      expect.any(Function),
    );
  });
});
