import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

const { getMessageMock } = vi.hoisted(() => ({
  getMessageMock: vi.fn(),
}));

vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: { getMessage: getMessageMock },
}));

import { getRoomMessageAction } from "./message-actions";

describe("getRoomMessageAction", () => {
  beforeEach(() => {
    getMessageMock.mockReset();
  });

  it("returns the requested message", async () => {
    const message = { id: "msg-1", roomId: "room-1", content: "Hello" };
    getMessageMock.mockResolvedValue(message);

    await expect(getRoomMessageAction("room-1", "msg-1")).resolves.toEqual({
      ok: true,
      value: message,
    });
    expect(getMessageMock).toHaveBeenCalledWith("room-1", "msg-1");
  });

  it("passes a refused message through as no message", async () => {
    getMessageMock.mockResolvedValue(null);

    await expect(getRoomMessageAction("room-1", "msg-1")).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a thrown failure as a failure", async () => {
    getMessageMock.mockRejectedValue(new Error("Boom"));

    await expect(getRoomMessageAction("room-1", "msg-1")).resolves.toEqual({
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR, message: "Boom" },
    });
  });

  it("uses the fallback for failures without a message", async () => {
    getMessageMock.mockRejectedValue(null);

    await expect(getRoomMessageAction("room-1", "msg-1")).resolves.toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Could not load message.",
      },
    });
  });
});
