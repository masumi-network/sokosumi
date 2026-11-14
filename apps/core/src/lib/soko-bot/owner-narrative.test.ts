import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, claims } = vi.hoisted(() => ({
  db: {
    sokoBotToolCall: { findMany: vi.fn(), findFirst: vi.fn() },
    sokoBotTurn: { findUnique: vi.fn() },
  },
  claims: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("./answer-claims", async (original) => ({
  ...(await original<typeof import("./answer-claims")>()),
  claimsAction: claims,
}));

import { ownerNarrative } from "./owner-narrative";

function ownerReadTurn() {
  return {
    source: "CHAT",
    route: "DIRECT_RESPONSE",
    userMessage: "Summarise my chat.",
    contextSnapshot: {
      packet: {
        trigger: {
          source: "CHAT",
          route: "DIRECT_RESPONSE",
          askedBy: { kind: "OWNER" },
        },
      },
    },
  };
}

describe("owner read-observation recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    claims.mockResolvedValue(true);
    db.sokoBotTurn.findUnique.mockResolvedValue(ownerReadTurn());
    db.sokoBotToolCall.findFirst.mockResolvedValue(null);
    db.sokoBotToolCall.findMany.mockImplementation(async ({ where }) =>
      where.capability.in.includes("read_chat")
        ? [{ capability: "read_chat", toolCallId: "read-current", result: {} }]
        : [],
    );
  });

  it.each(["Nothing to add.", "Nothing new worth flagging."])(
    "keeps the explicit plain silence response %s",
    async (text) => {
      expect(await ownerNarrative(text, "turn-current")).toBeUndefined();
      expect(claims).not.toHaveBeenCalled();
      expect(db.sokoBotToolCall.findMany).not.toHaveBeenCalled();
      expect(db.sokoBotTurn.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["failed read", { capability: "read_chat", status: "FAILED" }],
    ["attempted mutation", { capability: "create_task", status: "COMPLETED" }],
  ])("does not recover observations across a %s", async (_label, call) => {
    db.sokoBotToolCall.findFirst.mockImplementation(async ({ where }) =>
      call.status !== where.OR[0].status.not ||
      !where.OR[1].capability.notIn.includes(call.capability)
        ? { id: "disallowed-call" }
        : null,
    );
    const result = await ownerNarrative(
      "I changed everything.",
      "turn-current",
    );
    expect(result?.message).toBeNull();
    expect(result?.observationToolCallIds).toEqual([]);
    expect(db.sokoBotToolCall.findFirst).toHaveBeenCalledWith({
      where: {
        turnId: "turn-current",
        OR: [
          { status: { not: "COMPLETED" } },
          {
            capability: {
              notIn: expect.arrayContaining(["read_chat", "list_chats"]),
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it.each(["TEAMMATE", "ASSISTANT"])(
    "does not grant the owner recovery path to a %s",
    async (kind) => {
      const turn = ownerReadTurn();
      turn.contextSnapshot.packet.trigger.askedBy.kind = kind;
      db.sokoBotTurn.findUnique.mockResolvedValue(turn);
      const result = await ownerNarrative(
        "I changed everything.",
        "turn-current",
      );
      expect(result?.observationToolCallIds).toEqual([]);
      expect(db.sokoBotToolCall.findFirst).not.toHaveBeenCalled();
    },
  );

  it("keeps the unchecked warning instead of substituting read content", async () => {
    claims.mockResolvedValue(null);
    const result = await ownerNarrative(
      "Here is the chat recap.",
      "turn-current",
    );
    expect(result?.message).toContain("could not be checked");
    expect(result?.observationToolCallIds).toEqual([]);
    expect(db.sokoBotToolCall.findFirst).not.toHaveBeenCalled();
  });

  it.each(["SILENT", "CLARIFY"])(
    "preserves explicit %s intent without adding read excerpts",
    async (kind) => {
      const narrative = {
        kind,
        message: null,
        question: kind === "CLARIFY" ? "DETAILS" : null,
        observationToolCallIds: [],
      };
      expect(
        await ownerNarrative(JSON.stringify(narrative), "turn-current"),
      ).toEqual(narrative);
      expect(claims).not.toHaveBeenCalled();
      expect(db.sokoBotTurn.findUnique).not.toHaveBeenCalled();
      expect(db.sokoBotToolCall.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(["SILENT", "CLARIFY"])(
    "keeps %s intent when its nonempty prose is rejected",
    async (kind) => {
      const narrative = {
        kind,
        message: "I changed the Task. Which room did you mean?",
        question: kind === "CLARIFY" ? "TARGET" : null,
        observationToolCallIds: [],
      };
      expect(
        await ownerNarrative(JSON.stringify(narrative), "turn-current"),
      ).toEqual({
        ...narrative,
        message: null,
      });
      expect(db.sokoBotToolCall.findFirst).not.toHaveBeenCalled();
    },
  );

  it("does not substitute observations when a mutation is confirmed", async () => {
    db.sokoBotToolCall.findMany.mockImplementation(async ({ where }) =>
      where.capability.in.includes("read_chat")
        ? [{ capability: "read_chat", toolCallId: "read-current", result: {} }]
        : [{ capability: "update_memory" }],
    );
    const result = await ownerNarrative(
      "I changed everything.",
      "turn-current",
    );
    expect(result?.observationToolCallIds).toEqual([]);
    expect(db.sokoBotTurn.findUnique).not.toHaveBeenCalled();
    expect(db.sokoBotToolCall.findFirst).not.toHaveBeenCalled();
  });
});
