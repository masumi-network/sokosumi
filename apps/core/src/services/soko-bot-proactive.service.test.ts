import { beforeEach, describe, expect, it, vi } from "vitest";

const { botFindUniqueOrThrowMock, turnCountMock, getEnvMock } = vi.hoisted(
  () => ({
    botFindUniqueOrThrowMock: vi.fn(),
    turnCountMock: vi.fn(),
    getEnvMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findUniqueOrThrow: botFindUniqueOrThrowMock },
    sokoBotTurn: { count: turnCountMock },
  },
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  fetchInboxMessages: vi.fn(),
}));

import { proactiveGate } from "./soko-bot-proactive.service";

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({ SOKO_BOT_PROACTIVE_PAUSED: false });
  botFindUniqueOrThrowMock.mockResolvedValue({
    userId: "user-1",
    proactivePaused: false,
    proactiveDailyLimit: 20,
    ingestTimezone: "Europe/Vienna",
  });
  turnCountMock.mockResolvedValue(0);
});

describe("proactiveGate", () => {
  it("counts what the bot decided to do, not what a person asked", async () => {
    await proactiveGate("bot-1", new Date("2026-08-29T12:00:00.000Z"));

    const where = turnCountMock.mock.calls[0]?.[0]?.where;
    expect(where.OR).toEqual([
      { source: { in: ["SCHEDULE", "EVENT", "INGEST"] } },
      // Another bot asking is a machine deciding, so it counts.
      { chainDepth: { gt: 0 } },
    ]);
    // A teammate mentioning the bot is a person asking a question, not work
    // the bot decided to do; it must not draw on the unprompted allowance.
    expect(JSON.stringify(where)).not.toContain("requestedByUserId");
  });

  it("refuses once the daily allowance is spent", async () => {
    turnCountMock.mockResolvedValue(20);

    const gate = await proactiveGate("bot-1");

    expect(gate).toMatchObject({ ok: false, reason: "daily-limit", limit: 20 });
  });

  it("refuses while the owner has paused it", async () => {
    botFindUniqueOrThrowMock.mockResolvedValue({
      userId: "user-1",
      proactivePaused: true,
      proactiveDailyLimit: 20,
      ingestTimezone: "Europe/Vienna",
    });

    expect(await proactiveGate("bot-1")).toMatchObject({
      ok: false,
      reason: "paused",
    });
  });
});
