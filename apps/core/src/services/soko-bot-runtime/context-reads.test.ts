import { beforeEach, describe, expect, it, vi } from "vitest";

const { turnFindUnique, turnFindMany, scopeMock } = vi.hoisted(() => ({
  turnFindUnique: vi.fn(),
  turnFindMany: vi.fn(),
  scopeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUniqueOrThrow: turnFindUnique, findMany: turnFindMany },
  },
}));
vi.mock("@/lib/soko-bot/context-packet-scope", () => ({
  contextPacketScope: scopeMock,
}));

import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import { readContext } from "./context-reads";

const authorized = {
  turn: { id: "turn-now", sokoBotId: "bot-1", workspaceId: "ws-1" },
  reader: { userId: "user-1", audience: "TEAMMATE", sharedScope: null },
  askedByKind: "TEAMMATE",
} as unknown as AuthorizedSokoBotRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  turnFindUnique.mockResolvedValue({
    source: "CHAT",
    askedByUserId: "user-2",
    destinationRoomId: null,
    chatMention: { message: { roomId: "room-1" } },
  });
  scopeMock.mockReturnValue({ recentTurnWhere: { scoped: true } });
});

describe("readContext", () => {
  it("reads the conversation with the packet's own filters, never the current turn", async () => {
    const at = new Date("2026-11-01T10:00:00Z");
    turnFindMany.mockResolvedValue([
      {
        id: "t2",
        source: "CHAT",
        userMessage: "Budget?",
        finalAnswer: "14,500 EUR",
        createdAt: at,
      },
      {
        id: "t1",
        source: "CHAT",
        userMessage: "x",
        finalAnswer: "y",
        createdAt: at,
      },
    ]);
    const result = await readContext(authorized, {
      section: "conversation",
      query: "budget lisbon",
      limit: 1,
    });
    expect(scopeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "TEAMMATE",
        askedByUserId: "user-2",
        roomId: "room-1",
      }),
    );
    const [{ where }] = turnFindMany.mock.calls[0];
    expect(where.AND).toEqual(
      expect.arrayContaining([{ scoped: true }, { id: { not: "turn-now" } }]),
    );
    // scope, not this turn, no `before`, one entry per query word
    expect(where.AND).toHaveLength(5);
    expect(result).toEqual({
      turns: [
        {
          id: "t2",
          at: at.toISOString(),
          source: "CHAT",
          message: "Budget?",
          answer: "14,500 EUR",
        },
      ],
      olderBefore: at.toISOString(),
    });
  });

  it("names the sections when the input is wrong", async () => {
    await expect(readContext(authorized, { section: "tasks" })).rejects.toThrow(
      /conversation, projects or jobs/,
    );
  });
});
