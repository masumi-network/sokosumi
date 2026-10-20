import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  assertNotSharedSokoBotRoom,
  isRetiredSharedSokoBotRoom,
} from "./shared-soko-bot-room";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function clientWith(bot: { id: string } | null) {
  return { sokoBot: { findUnique: vi.fn(async () => bot) } };
}

describe("assertNotSharedSokoBotRoom", () => {
  it("lets a room through that no bot names as its shared room", async () => {
    const client = clientWith(null);

    await expect(
      assertNotSharedSokoBotRoom(ROOM_ID, "archive", client as never),
    ).resolves.toBeUndefined();
    expect(client.sokoBot.findUnique).toHaveBeenCalledWith({
      where: { sharedRoomId: ROOM_ID },
      select: { id: true },
    });
  });

  it.each([
    ["archive", /cannot be archived/],
    ["delete", /cannot be permanently deleted/],
    ["external", /cannot take guests/],
  ] as const)(
    "refuses to %s a shared bot's room with 400",
    async (change, message) => {
      const error = await assertNotSharedSokoBotRoom(
        ROOM_ID,
        change,
        clientWith({ id: "bot" }) as never,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(400);
      expect((error as HTTPException).message).toMatch(message);
    },
  );
});

describe("isRetiredSharedSokoBotRoom", () => {
  const at = new Date("2026-10-14T12:00:00.000Z");

  it("is false for a room without a shared bot", () => {
    expect(isRetiredSharedSokoBotRoom({ sharedSokoBot: null })).toBe(false);
    expect(isRetiredSharedSokoBotRoom({})).toBe(false);
  });

  it("is false while the shared bot is live", () => {
    expect(
      isRetiredSharedSokoBotRoom({
        sharedSokoBot: { archivedAt: null, deletedAt: null },
      }),
    ).toBe(false);
  });

  it("is true once the shared bot is archived or deleted", () => {
    expect(
      isRetiredSharedSokoBotRoom({
        sharedSokoBot: { archivedAt: at, deletedAt: null },
      }),
    ).toBe(true);
    expect(
      isRetiredSharedSokoBotRoom({
        sharedSokoBot: { archivedAt: null, deletedAt: at },
      }),
    ).toBe(true);
  });
});
