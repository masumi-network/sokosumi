import { beforeEach, describe, expect, it, vi } from "vitest";

const { scheduleFindManyMock, integrationFindManyMock, turnFindFirstMock } =
  vi.hoisted(() => ({
    scheduleFindManyMock: vi.fn(),
    integrationFindManyMock: vi.fn(),
    turnFindFirstMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotSchedule: { findMany: scheduleFindManyMock },
    sokoBotIntegration: { findMany: integrationFindManyMock },
    sokoBotTurn: { findFirst: turnFindFirstMock },
  },
}));

import { sokoBotAutomationChecks } from "./soko-bot-stats.service";

describe("sokoBotAutomationChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleFindManyMock.mockResolvedValue([]);
    turnFindFirstMock.mockResolvedValue(null);
  });

  it("shows when a calendar was last read, not only mail checks", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1_000);
    integrationFindManyMock.mockResolvedValue([
      {
        provider: "gmail",
        cursor: { lastIngestAt: recent.toISOString() },
        lastIngestAt: recent,
      },
      // Read by the stand-up: no cursor, but the read stamped the row.
      { provider: "googlecalendar", cursor: null, lastIngestAt: recent },
    ]);

    const checks = await sokoBotAutomationChecks("bot-1");

    expect(checks.items).toEqual([
      expect.objectContaining({
        key: "mail",
        name: "gmail",
        lastRunAt: recent.toISOString(),
        late: false,
      }),
      expect.objectContaining({
        key: "calendar",
        name: "googlecalendar",
        lastRunAt: recent.toISOString(),
        late: false,
      }),
    ]);
  });

  it("only calls a calendar late after days without a read", async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1_000);
    integrationFindManyMock.mockResolvedValue([
      { provider: "gmail", cursor: null, lastIngestAt: fiveHoursAgo },
      { provider: "googlecalendar", cursor: null, lastIngestAt: fiveHoursAgo },
    ]);

    const checks = await sokoBotAutomationChecks("bot-1");

    expect(checks.items.map((item) => [item.key, item.late])).toEqual([
      ["mail", true],
      ["calendar", false],
    ]);
  });
});
