import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  buzzChannel: { findMany: vi.fn(), update: vi.fn() },
  chatRoomMessage: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

const relay = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { client, pool: { connect: vi.fn(async () => client) } };
});
vi.mock("@/lib/buzz/relay-database", () => ({
  relayDatabase: () => relay.pool,
}));

import { importBuzzHistory } from "./buzz-history-import.service";

const channel = (id: string, host: string) => ({
  id,
  channelId: `${id}-channel`,
  roomId: `${id}-room`,
  createdAt: new Date("2026-11-15T00:00:00Z"),
  community: { relayUrl: `wss://${host}` },
});

describe("importBuzzHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.chatRoomMessage.findMany.mockResolvedValue([]);
    relay.client.query.mockImplementation(
      async (_sql: string, params: string[]) => {
        if (params[0] === "broken.chat.example") {
          throw new Error("relay database unreachable");
        }
        return { rows: [{ id: "community" }] };
      },
    );
  });

  it("keeps going past a room that fails, and rests that room a while", async () => {
    db.buzzChannel.findMany.mockResolvedValue([
      channel("a", "broken.chat.example"),
      channel("b", "fine.chat.example"),
    ]);
    const log = vi.fn();

    await expect(importBuzzHistory({ log })).resolves.toBe(1);
    expect(db.buzzChannel.update).toHaveBeenCalledWith({
      where: { id: "b" },
      data: { historyImportedAt: expect.any(Date) },
    });
    expect(db.buzzChannel.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a" } }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      "relay database unreachable",
    );

    // The next pass does not pick the failed room first again.
    db.buzzChannel.findMany.mockResolvedValue([]);
    await importBuzzHistory({ log });
    expect(db.buzzChannel.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ["a"] } }),
      }),
    );
  });
});
