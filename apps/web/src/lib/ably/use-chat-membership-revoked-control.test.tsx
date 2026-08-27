import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controlHandlers = new Map<string, (message: unknown) => void>();
const getMock = vi.fn((name: string) => {
  return {
    subscribe: vi.fn((event: string, handler: (message: unknown) => void) => {
      if (event === "chat_membership_revoked") {
        controlHandlers.set(name, handler);
      }
    }),
    unsubscribe: vi.fn(),
  };
});

vi.mock("ably/react", () => ({
  useAbly: () => ({
    channels: { get: getMock },
  }),
}));

import { useChatMembershipRevokedControl } from "./use-chat-membership-revoked-control";

describe("useChatMembershipRevokedControl", () => {
  beforeEach(() => {
    controlHandlers.clear();
    getMock.mockClear();
  });

  it("subscribes to the user control channel and forwards valid revokes", async () => {
    const onRevoked = vi.fn();

    renderHook(() =>
      useChatMembershipRevokedControl({
        currentUserId: "user_1",
        onRevoked,
      }),
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("chat_control:user_user_1");
    });

    const handler = controlHandlers.get("chat_control:user_user_1");
    expect(handler).toBeTypeOf("function");

    act(() => {
      handler?.({
        data: {
          roomId: "room-kicked",
          reason: "left",
          at: "2026-08-10T12:00:00.000Z",
        },
      });
    });

    expect(onRevoked).toHaveBeenCalledWith({
      roomId: "room-kicked",
      reason: "left",
      at: "2026-08-10T12:00:00.000Z",
    });
  });

  it("does not subscribe without a current user id", () => {
    renderHook(() =>
      useChatMembershipRevokedControl({
        currentUserId: "",
        onRevoked: vi.fn(),
      }),
    );

    expect(getMock).not.toHaveBeenCalled();
  });
});
