import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { sokoBotMessageMemberId } from "./soko-bot-message-member";

const TURN_ID = "01a0efbb-778c-7669-86b6-d50d81e74299";

function client(turn: { requestedByUserId: string } | null) {
  const findFirst = vi.fn().mockResolvedValue(turn);
  return { findFirst, db: { sokoBotTurn: { findFirst } } as never };
}

describe("sokoBotMessageMemberId", () => {
  it("speaks for a personal bot's owner without a query", async () => {
    const { findFirst, db } = client(null);
    await expect(
      sokoBotMessageMemberId(
        { id: "bot", userId: "owner" },
        { metadata: null, clientMessageId: null },
        db,
      ),
    ).resolves.toBe("owner");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("speaks for the member whose turn wrote a shared bot's message", async () => {
    const { findFirst, db } = client({ requestedByUserId: "member" });
    await expect(
      sokoBotMessageMemberId(
        { id: "bot", userId: null },
        { metadata: { soko_bot: { turn_id: TURN_ID } }, clientMessageId: null },
        db,
      ),
    ).resolves.toBe("member");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: TURN_ID, sokoBotId: "bot" },
      select: { requestedByUserId: true },
    });
  });

  it.each([
    ["no metadata", null],
    ["no turn id", { soko_bot: {} }],
    ["a turn id that is not a uuid", { soko_bot: { turn_id: "x' OR 1" } }],
    ["a metadata array", [TURN_ID]],
  ])("is null for a shared bot's message with %s", async (_label, metadata) => {
    const { findFirst, db } = client({ requestedByUserId: "member" });
    await expect(
      sokoBotMessageMemberId(
        { id: "bot", userId: null },
        { metadata, clientMessageId: null },
        db,
      ),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("is null when the turn belongs to another bot", async () => {
    const { db } = client(null);
    await expect(
      sokoBotMessageMemberId(
        { id: "bot", userId: null },
        { metadata: { soko_bot: { turn_id: TURN_ID } }, clientMessageId: null },
        db,
      ),
    ).resolves.toBeNull();
  });

  it("reads the turn from a post_chat message's client key", async () => {
    const { findFirst, db } = client({ requestedByUserId: "member" });
    await expect(
      sokoBotMessageMemberId(
        { id: "bot", userId: null },
        {
          metadata: { soko_bot_chain: { depth: 1, max_depth: 3 } },
          clientMessageId: `soko-bot-tool:${TURN_ID}:call_1`,
        },
        db,
      ),
    ).resolves.toBe("member");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: TURN_ID, sokoBotId: "bot" },
      select: { requestedByUserId: true },
    });
  });

  it.each([
    ["another key shape", `soko-bot:${TURN_ID}:final`],
    ["a turn id that is not a uuid", "soko-bot-tool:x' OR 1:call_1"],
  ])("ignores a client key with %s", async (_label, clientMessageId) => {
    const { findFirst, db } = client({ requestedByUserId: "member" });
    await expect(
      sokoBotMessageMemberId(
        { id: "bot", userId: null },
        { metadata: null, clientMessageId },
        db,
      ),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
