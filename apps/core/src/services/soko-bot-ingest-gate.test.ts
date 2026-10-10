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
  checkMailImportanceMock,
  logSetMock,
  logEmitMock,
} = vi.hoisted(() => ({
  botFindManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  integrationUpdateMock: vi.fn(),
  botUpdateMock: vi.fn(),
  activeIntegrationsMock: vi.fn(),
  fetchInboxMock: vi.fn(),
  proactiveGateMock: vi.fn(),
  startTurnMock: vi.fn(),
  checkMailImportanceMock: vi.fn(),
  logSetMock: vi.fn(),
  logEmitMock: vi.fn(),
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
vi.mock("@/lib/soko-bot/mail-importance", () => ({
  checkMailImportance: checkMailImportanceMock,
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
    const log = { set: logSetMock, emit: logEmitMock };
    checkMailImportanceMock.mockImplementation(async ({ mail }) => ({
      important: mail,
      log,
    }));
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
    expect(logSetMock).toHaveBeenCalledWith({
      outcome: "woke",
      turn: { id: "t" },
    });
    expect(logEmitMock).toHaveBeenCalledOnce();
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

  it.each([
    ["no mail is important", []],
    ["the importance check failed", null],
  ])(
    "does not wake the bot when %s, and moves past the mail",
    async (_, important) => {
      proactiveGateMock.mockResolvedValue({
        ok: true,
        usedToday: 3,
        limit: 20,
      });
      checkMailImportanceMock.mockResolvedValue({
        important,
        log: { set: logSetMock, emit: logEmitMock },
      });
      expect((await run()).skipped).toBe(1);
      expect(startTurnMock).not.toHaveBeenCalled();
      expect(logSetMock).toHaveBeenCalledWith({ outcome: "quiet" });
      expect(logEmitMock).toHaveBeenCalledOnce();
      expect(integrationUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cursor: expect.objectContaining({
              newestSeenAt: "2026-09-30T12:00:00.000Z",
            }),
          }),
        }),
      );
    },
  );

  it("reads the last 24 hours for the morning briefing, without the importance check", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T13:00:00.000Z") });
    scheduleFindFirstMock.mockResolvedValue(null);
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 3, limit: 20 });
    try {
      expect((await run()).briefings).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(fetchInboxMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        since: new Date("2026-09-29T13:00:00.000Z"),
      }),
    );
    expect(checkMailImportanceMock).not.toHaveBeenCalled();
    expect(startTurnMock.mock.calls[0][0].message).toContain("Invoice");
  });
});
