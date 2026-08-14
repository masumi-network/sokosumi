import { describe, expect, it, vi } from "vitest";

import { applyChatMembershipRevokedUi } from "../apply-chat-membership-revoked-ui";

describe("applyChatMembershipRevokedUi", () => {
  it("soft-removes the room and does not navigate when another room is active", () => {
    const notifyRemoved = vi.fn();
    const replace = vi.fn();
    const refresh = vi.fn();

    applyChatMembershipRevokedUi({
      roomId: "room-kicked",
      activeRoomId: "room-other",
      replace,
      refresh,
      notifyRemoved,
    });

    expect(notifyRemoved).toHaveBeenCalledWith("room-kicked");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("soft-removes and lands on /chat when the open room is revoked", () => {
    const notifyRemoved = vi.fn();
    const replace = vi.fn();
    const refresh = vi.fn();

    applyChatMembershipRevokedUi({
      roomId: "room-kicked",
      activeRoomId: "room-kicked",
      replace,
      refresh,
      notifyRemoved,
    });

    expect(notifyRemoved).toHaveBeenCalledWith("room-kicked");
    expect(replace).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("soft-removes when no room is selected", () => {
    const notifyRemoved = vi.fn();
    const replace = vi.fn();
    const refresh = vi.fn();

    applyChatMembershipRevokedUi({
      roomId: "room-kicked",
      activeRoomId: null,
      replace,
      refresh,
      notifyRemoved,
    });

    expect(notifyRemoved).toHaveBeenCalledWith("room-kicked");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is safe to call twice for the same room (idempotent intent)", () => {
    const notifyRemoved = vi.fn();
    const replace = vi.fn();
    const refresh = vi.fn();

    const options = {
      roomId: "room-kicked",
      activeRoomId: "room-kicked" as string | null,
      replace,
      refresh,
      notifyRemoved,
    };

    applyChatMembershipRevokedUi(options);
    applyChatMembershipRevokedUi({ ...options, activeRoomId: null });

    expect(notifyRemoved).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
