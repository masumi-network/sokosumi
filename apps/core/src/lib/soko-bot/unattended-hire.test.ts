import { beforeEach, describe, expect, it, vi } from "vitest";

const { sokoBotToolCall } = vi.hoisted(() => ({
  sokoBotToolCall: { count: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ default: { sokoBotToolCall } }));

import { unattendedHireRefusal } from "./unattended-hire";

const base = {
  turn: { id: "turn", source: "SCHEDULE", chainDepth: 0 },
  shared: false,
  maxCredits: 5,
  ceiling: 10,
  toolCallId: "call",
};

beforeEach(() => {
  vi.resetAllMocks();
  sokoBotToolCall.count.mockResolvedValue(0);
});

describe("unattendedHireRefusal", () => {
  it("allows a member-asked hire without counting", async () => {
    await expect(
      unattendedHireRefusal({
        ...base,
        turn: { ...base.turn, source: "CHAT" },
        maxCredits: 1000,
      }),
    ).resolves.toBeNull();
    expect(sokoBotToolCall.count).not.toHaveBeenCalled();
  });

  it("allows a first unattended hire under the ceiling", async () => {
    await expect(unattendedHireRefusal(base)).resolves.toBeNull();
    expect(sokoBotToolCall.count).toHaveBeenCalledWith({
      where: {
        turnId: "turn",
        capability: "hire_agent",
        NOT: { toolCallId: "call" },
      },
    });
  });

  it("refuses a second unattended hire, asking the owner", async () => {
    sokoBotToolCall.count.mockResolvedValue(1);
    await expect(unattendedHireRefusal(base)).resolves.toBe(
      "A turn nobody asked for may hire once. Report what you found and ask the owner before hiring again.",
    );
  });

  it("refuses a shared bot's second hire, asking the team", async () => {
    sokoBotToolCall.count.mockResolvedValue(1);
    const refusal = await unattendedHireRefusal({ ...base, shared: true });
    expect(refusal).toContain("the team in your shared room");
    expect(refusal).not.toContain("owner");
  });

  it("refuses an unattended hire over the ceiling", async () => {
    await expect(
      unattendedHireRefusal({ ...base, maxCredits: 11 }),
    ).resolves.toBe(
      "A turn nobody asked for may commit at most 10 credits; this asked for 11. Ask the owner in their chat instead.",
    );
    const shared = await unattendedHireRefusal({
      ...base,
      shared: true,
      maxCredits: 11,
    });
    expect(shared).toContain("the team in your shared room");
    expect(shared).not.toContain("owner");
  });
});
