import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getRoomMock = vi.fn();

vi.mock("@/lib/services", () => ({
  chatRoomService: {
    getRoom: (...args: unknown[]) => getRoomMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { loadChatRoom } from "../load-chat-room";

describe("loadChatRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns room on success", async () => {
    const room = { id: "room_1" };
    getRoomMock.mockResolvedValue(room);

    await expect(loadChatRoom("room_1")).resolves.toEqual({
      room,
      failed: false,
    });
    expect(getRoomMock).toHaveBeenCalledWith("room_1");
  });

  it("returns null room without failure when getRoom soft-fails 404/403", async () => {
    getRoomMock.mockResolvedValue(null);

    await expect(loadChatRoom("room_missing")).resolves.toEqual({
      room: null,
      failed: false,
    });
  });

  it("soft-fails CoreApiRequestError instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getRoomMock.mockRejectedValue(
      new CoreApiRequestError("An unexpected error occurred", {
        status: 500,
        kind: undefined,
      }),
    );

    await expect(loadChatRoom("room_1")).resolves.toEqual({
      room: null,
      failed: true,
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rethrows unexpected errors", async () => {
    getRoomMock.mockRejectedValue(new Error("boom"));

    await expect(loadChatRoom("room_1")).rejects.toThrow("boom");
  });
});
