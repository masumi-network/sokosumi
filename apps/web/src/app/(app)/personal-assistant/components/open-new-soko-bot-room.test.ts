import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureRoomMock = vi.fn();
const introduceMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: (...a: unknown[]) => ensureRoomMock(...a),
}));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  introduceSokoBotAction: (...a: unknown[]) => introduceMock(...a),
}));

import { openNewSokoBotRoom } from "./open-new-soko-bot-room";

describe("openNewSokoBotRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the direct room and lets the bot say hello", async () => {
    ensureRoomMock.mockResolvedValue({ ok: true, value: { id: "room-1" } });
    await expect(openNewSokoBotRoom("bot-1")).resolves.toBe("room-1");
    expect(ensureRoomMock).toHaveBeenCalledWith("bot-1");
    expect(introduceMock).toHaveBeenCalledWith({ roomId: "room-1" });
  });

  it("returns null and says nothing when the room does not open", async () => {
    ensureRoomMock.mockResolvedValue({ ok: false, error: { message: "no" } });
    await expect(openNewSokoBotRoom("bot-1")).resolves.toBeNull();
    expect(introduceMock).not.toHaveBeenCalled();
  });
});
