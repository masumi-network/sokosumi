import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMentionMock, updateManyMock } = vi.hoisted(() => ({
  findManyMentionMock: vi.fn(),
  updateManyMock: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMention: {
      findMany: findManyMentionMock,
      updateMany: updateManyMock,
    },
  },
}));

import {
  claimMentionForDispatch,
  listStaleSentChatRoomMentionIds,
  markMentionFailed,
  ROOM_COWORKER_CHUNK_MS,
  ROOM_COWORKER_STREAM_TIMEOUT,
  ROOM_COWORKER_TOTAL_MS,
  ROOM_SENT_STALE_MS,
} from "./chat-room-mention-state";

const MENTION_ID = "mention_1";
beforeEach(() => {
  vi.clearAllMocks();
});

describe("room coworker stream timeout budgets", () => {
  it("omits firstChunkMs so silent think is bounded only by totalMs", () => {
    expect(ROOM_COWORKER_STREAM_TIMEOUT).toEqual({
      totalMs: ROOM_COWORKER_TOTAL_MS,
      chunkMs: ROOM_COWORKER_CHUNK_MS,
    });
    expect(ROOM_COWORKER_STREAM_TIMEOUT).not.toHaveProperty("firstChunkMs");
    expect(ROOM_COWORKER_CHUNK_MS).toBe(90_000);
    expect(ROOM_COWORKER_TOTAL_MS).toBe(240_000);
    expect(ROOM_COWORKER_TOTAL_MS).toBeGreaterThan(ROOM_COWORKER_CHUNK_MS);
    expect(ROOM_SENT_STALE_MS).toBeGreaterThan(ROOM_COWORKER_TOTAL_MS);
  });
});

describe("listStaleSentChatRoomMentionIds", () => {
  it("queries unfinished mentions older than the stale window for the room", async () => {
    findManyMentionMock.mockResolvedValue([{ id: MENTION_ID }]);
    const now = new Date("2025-06-01T12:00:00.000Z");

    const ids = await listStaleSentChatRoomMentionIds("room_1", { now });

    expect(ids).toEqual([MENTION_ID]);
    expect(findManyMentionMock).toHaveBeenCalledWith({
      where: {
        // Pending too: a row written but never handed to the dispatcher is
        // stranded otherwise, because nothing else retries it.
        status: { in: ["pending", "sent"] },
        updatedAt: { lt: new Date(now.getTime() - ROOM_SENT_STALE_MS) },
        message: { roomId: "room_1" },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });
  });
});

describe("mention state transitions", () => {
  it("does not fail an already responded mention", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    await markMentionFailed(MENTION_ID, "late worker failed");
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: { not: "responded" } },
      data: { status: "failed", error: "late worker failed" },
    });
  });
  it("claims pending mentions without touching terminal responses", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    await expect(claimMentionForDispatch(MENTION_ID)).resolves.toBe(true);
    expect(updateManyMock).toHaveBeenCalledOnce();
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: "pending" },
      data: { status: "sent", error: null },
    });
  });
});
