import { beforeEach, describe, expect, it, vi } from "vitest";

const { turnFindUnique, turnFindMany, projectFindMany, scopeMock } = vi.hoisted(
  () => ({
    turnFindUnique: vi.fn(),
    turnFindMany: vi.fn(),
    projectFindMany: vi.fn(),
    scopeMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUniqueOrThrow: turnFindUnique, findMany: turnFindMany },
    project: { findMany: projectFindMany },
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
    // scope, not this turn, no cursor, one entry per query word
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
      next: `${at.toISOString()}|t2`,
    });
  });

  it("pages on (time, id), so a sibling with the same time is not skipped", async () => {
    turnFindMany.mockResolvedValue([]);
    const at = "2026-11-01T10:00:00.000Z";
    await readContext(authorized, {
      section: "conversation",
      cursor: `${at}|t2`,
    });
    const [{ where }] = turnFindMany.mock.calls[0];
    expect(where.AND).toContainEqual({
      OR: [
        { createdAt: { lt: new Date(at) } },
        { createdAt: new Date(at), id: { lt: "t2" } },
      ],
    });
  });

  it("returns only what fits and continues right after it, never past unread turns", async () => {
    const long = "word ".repeat(400);
    const rows = Array.from({ length: 26 }, (_, index) => ({
      id: `turn_${String(25 - index).padStart(2, "0")}`,
      source: "CHAT",
      userMessage: long,
      finalAnswer: long,
      createdAt: new Date(Date.UTC(2026, 10, 1, 10, 0, 59 - index)),
    }));
    turnFindMany.mockResolvedValue(rows);
    const result = (await readContext(authorized, {
      section: "conversation",
      limit: 25,
    })) as { turns: { id: string }[]; next: string };
    expect(JSON.stringify(result).length).toBeLessThan(16_384);
    const last = rows[result.turns.length - 1];
    expect(result.turns.length).toBeLessThan(25);
    expect(result.next).toBe(`${last?.createdAt.toISOString()}|${last?.id}`);
  });

  it("shows the part of a long answer around the query match", async () => {
    turnFindMany.mockResolvedValue([
      {
        id: "t1",
        source: "CHAT",
        userMessage: "Where is it?",
        finalAnswer: `${"filler ".repeat(200)}SECRET_NEEDLE here`,
        createdAt: new Date("2026-11-01T10:00:00Z"),
      },
    ]);
    const result = (await readContext(authorized, {
      section: "conversation",
      query: "secret_needle",
    })) as { turns: { answer: string }[] };
    expect(result.turns[0]?.answer).toContain("SECRET_NEEDLE");
  });

  it("pages Projects with a cursor and finds words of the summary", async () => {
    const at = new Date("2026-11-02T09:00:00Z");
    const project = (id: string) => ({
      id,
      name: id,
      briefing: "Lisbon launch",
      updatedAt: at,
      _count: { tasks: 0 },
    });
    projectFindMany.mockResolvedValue([project("p2"), project("p1")]);
    const first = (await readContext(authorized, {
      section: "projects",
      query: "lisbon",
      limit: 1,
    })) as { next: string };
    expect(first.next).toBe(`${at.toISOString()}|p2`);
    await readContext(authorized, {
      section: "projects",
      cursor: first.next,
    });
    const [{ where: firstWhere }] = projectFindMany.mock.calls[0];
    expect(firstWhere.AND.at(-1)).toEqual({
      OR: [
        { name: { contains: "lisbon", mode: "insensitive" } },
        { briefing: { contains: "lisbon", mode: "insensitive" } },
      ],
    });
    const [{ where: secondWhere }] = projectFindMany.mock.calls[1];
    expect(secondWhere.AND).toContainEqual({
      OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: "p2" } }],
    });
  });

  it("refuses a cursor it did not hand out", async () => {
    await expect(
      readContext(authorized, { section: "jobs", cursor: "yesterday" }),
    ).rejects.toThrow(/cursor/);
  });

  it("narrows by a one-letter query instead of returning everything", async () => {
    turnFindMany.mockResolvedValue([]);
    await readContext(authorized, { section: "conversation", query: "X" });
    const [{ where }] = turnFindMany.mock.calls[0];
    // scope, not this turn, no cursor, and the one word
    expect(where.AND).toHaveLength(4);
    expect(where.AND.at(-1)).toEqual({
      OR: [
        { userMessage: { contains: "X", mode: "insensitive" } },
        { finalAnswer: { contains: "X", mode: "insensitive" } },
      ],
    });
  });

  it("names the sections when the input is wrong", async () => {
    await expect(readContext(authorized, { section: "tasks" })).rejects.toThrow(
      /conversation, projects or jobs/,
    );
  });
});
