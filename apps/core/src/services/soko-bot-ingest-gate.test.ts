import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindManyMock,
  scheduleFindFirstMock,
  integrationUpdateMock,
  botUpdateMock,
  activeIntegrationsMock,
  fetchInboxMock,
  proactiveGateMock,
  startTurnMock,
} = vi.hoisted(() => ({
  botFindManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  integrationUpdateMock: vi.fn(),
  botUpdateMock: vi.fn(),
  activeIntegrationsMock: vi.fn(),
  fetchInboxMock: vi.fn(),
  proactiveGateMock: vi.fn(),
  startTurnMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findMany: botFindManyMock, update: botUpdateMock },
    sokoBotSchedule: { findFirst: scheduleFindFirstMock },
    sokoBotIntegration: { update: integrationUpdateMock },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class extends Error {},
  sokoBotControlPlane: { startTurn: startTurnMock, reconcileTurn: vi.fn() },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: activeIntegrationsMock,
  fetchInboxMessages: fetchInboxMock,
  fetchCalendarEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: proactiveGateMock,
}));

import { SokoBotIngestSyncService } from "./soko-bot-ingest.service";

const LAST_SEEN = "2026-09-30T06:14:00.000Z";

function run() {
  return new SokoBotIngestSyncService().syncIngest({
    abortSignal: new AbortController().signal,
    shouldContinue: () => true,
  });
}

describe("soko-bot ingest when the daily limit is spent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botFindManyMock.mockResolvedValue([
      {
        id: "bot-1",
        userId: "owner",
        workspaceId: "ws",
        ingestTimezone: "Europe/Berlin",
        lastBriefingAt: null,
      },
    ]);
    scheduleFindFirstMock.mockResolvedValue({ id: "standup" });
    activeIntegrationsMock.mockResolvedValue([
      {
        id: "gmail-1",
        provider: { id: "gmail" },
        cursor: {
          newestSeenAt: LAST_SEEN,
          lastIngestAt: "2026-09-30T05:00:00.000Z",
        },
      },
    ]);
    fetchInboxMock.mockResolvedValue([
      {
        provider: "gmail",
        id: "m1",
        receivedAt: "2026-09-30T12:00:00.000Z",
        subject: "Invoice",
        from: "a@b.c",
        snippet: "",
        unread: true,
      },
    ]);
    startTurnMock.mockResolvedValue({ turnId: "t", status: "COMPLETED" });
  });

  it("keeps the mail unseen for the next open slot", async () => {
    proactiveGateMock.mockResolvedValue({
      ok: false,
      reason: "daily-limit",
      usedToday: 20,
      limit: 20,
    });
    expect((await run()).skipped).toBe(1);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(integrationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: expect.objectContaining({ newestSeenAt: LAST_SEEN }),
        }),
      }),
    );
  });

  it("moves the cursor past mail the bot was shown", async () => {
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 3, limit: 20 });
    expect((await run()).deltas).toBe(1);
    expect(integrationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: expect.objectContaining({
            newestSeenAt: "2026-09-30T12:00:00.000Z",
          }),
        }),
      }),
    );
  });
});
