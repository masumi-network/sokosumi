import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MailTriageTag } from "@/lib/soko-bot/mail-triage";

const {
  botFindManyMock,
  scheduleFindFirstMock,
  integrationUpdateMock,
  botUpdateMock,
  activeIntegrationsMock,
  fetchInboxMock,
  proactiveGateMock,
  startTurnMock,
  triageMailMock,
  logSetMock,
  logEmitMock,
  sweepMock,
} = vi.hoisted(() => ({
  sweepMock: vi.fn(),
  botFindManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  integrationUpdateMock: vi.fn(),
  botUpdateMock: vi.fn(),
  activeIntegrationsMock: vi.fn(),
  fetchInboxMock: vi.fn(),
  proactiveGateMock: vi.fn(),
  startTurnMock: vi.fn(),
  triageMailMock: vi.fn(),
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
vi.mock("@/services/soko-bot-integration-leaver.service", () => ({
  sweepLeaverSokoBotIntegrations: sweepMock,
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: proactiveGateMock,
}));
vi.mock("@/lib/soko-bot/mail-triage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot/mail-triage")>()),
  triageMail: triageMailMock,
}));

import { SokoBotIngestSyncService } from "./soko-bot-ingest.service";

const LAST_SEEN = "2026-09-30T06:14:00.000Z";

function run() {
  return new SokoBotIngestSyncService().syncIngest({
    abortSignal: new AbortController().signal,
    shouldContinue: () => true,
  });
}

function tagAll(mail: SokoBotInboxMessage[], tag: MailTriageTag | null) {
  return mail.map((message) => ({
    message,
    tag,
    probability: tag ? 0.9 : null,
  }));
}

function setUp() {
  vi.clearAllMocks();
  sweepMock.mockResolvedValue(0);
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
  triageMailMock.mockImplementation(async ({ mail }) => ({
    mail: tagAll(mail, "URGENT"),
    failed: false,
    log,
  }));
}

describe("soko-bot ingest when the daily limit is spent", () => {
  beforeEach(setUp);

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
    ["no mail is urgent", "NOTABLE" as const],
    ["Jev is unavailable", null],
  ])(
    "does not wake the bot when %s, and moves past the mail",
    async (_, tag) => {
      proactiveGateMock.mockResolvedValue({
        ok: true,
        usedToday: 3,
        limit: 20,
      });
      triageMailMock.mockImplementation(async ({ mail }) => ({
        mail: tagAll(mail, tag),
        failed: tag === null,
        log: { set: logSetMock, emit: logEmitMock },
      }));
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

  it("wakes for urgent mail and shows notable mail with it, bulk as a count", async () => {
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 3, limit: 20 });
    fetchInboxMock.mockResolvedValue(
      ["Payout failed", "Coffee next week?", "Weekly digest"].map(
        (subject, index) => ({
          provider: "gmail",
          id: `m${index}`,
          threadId: null,
          receivedAt: `2026-09-30T12:0${index}:00.000Z`,
          subject,
          from: "a@b.c",
          to: [],
          snippet: "",
          unread: true,
          labels: [],
        }),
      ),
    );
    const tags = new Map<string, MailTriageTag>([
      ["Payout failed", "URGENT"],
      ["Coffee next week?", "NOTABLE"],
      ["Weekly digest", "BULK"],
    ]);
    triageMailMock.mockImplementation(async ({ mail }) => ({
      mail: mail.map((message: SokoBotInboxMessage) => ({
        message,
        tag: tags.get(message.subject) ?? null,
        probability: 0.9,
      })),
      failed: false,
      log: { set: logSetMock, emit: logEmitMock },
    }));
    expect((await run()).deltas).toBe(1);
    expect(triageMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "delta" }),
    );
    const message: string = startTurnMock.mock.calls[0][0].message;
    expect(message).toMatch(/Jev triaged as urgent/);
    expect(message).toContain("`Nothing new worth flagging.`");
    expect(message.indexOf("Payout failed")).toBeLessThan(
      message.indexOf("Coffee next week?"),
    );
    expect(message).toContain("### Bulk (1)\n- a@b.c");
    expect(message).not.toContain("Weekly digest");
  });

  it("still briefs every mail, untagged, when Jev is unavailable", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T13:00:00.000Z") });
    scheduleFindFirstMock.mockResolvedValue(null);
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 3, limit: 20 });
    triageMailMock.mockImplementation(async ({ mail }) => ({
      mail: tagAll(mail, null),
      failed: true,
      log: { set: logSetMock, emit: logEmitMock },
    }));
    try {
      expect((await run()).briefings).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    const message = startTurnMock.mock.calls[0][0].message;
    expect(message).toContain("### Not triaged (1)");
    expect(message).toContain("Invoice");
  });

  it("reads the last 24 hours for the morning briefing, triaged, whatever the tags", async () => {
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
    expect(triageMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ sokoBotId: "bot-1", source: "briefing" }),
    );
    const message = startTurnMock.mock.calls[0][0].message;
    expect(message).toContain("### Urgent (1)");
    expect(message).toContain("Invoice");
    expect(logSetMock).toHaveBeenCalledWith({
      outcome: "woke",
      turn: { id: "t" },
    });
  });
});

describe("soko-bot ingest member", () => {
  beforeEach(() => {
    setUp();
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 3, limit: 20 });
  });

  function sharedBot() {
    botFindManyMock.mockResolvedValue([
      {
        id: "bot-1",
        userId: null,
        workspaceId: "ws",
        ingestTimezone: "Europe/Berlin",
        lastBriefingAt: null,
      },
    ]);
    activeIntegrationsMock.mockResolvedValue([
      {
        id: "gmail-1",
        provider: { id: "gmail" },
        connectorUserId: "connector",
        cursor: {
          newestSeenAt: LAST_SEEN,
          lastIngestAt: "2026-09-30T05:00:00.000Z",
        },
      },
    ]);
  }

  it("runs a shared bot's turn for nobody, not for whoever connected the mailbox", async () => {
    sharedBot();
    expect((await run()).deltas).toBe(1);
    expect(startTurnMock.mock.calls[0][0]).toMatchObject({
      userId: null,
      sokoBotId: "bot-1",
      workspaceId: "ws",
      source: "INGEST",
    });
  });

  it("runs a personal bot's turn for its owner, with no id and no member lookup", async () => {
    expect((await run()).deltas).toBe(1);
    expect(startTurnMock.mock.calls[0][0].userId).toBe("owner");
    expect(startTurnMock.mock.calls[0][0]).not.toHaveProperty("sokoBotId");
  });

  it("sweeps leavers' integrations before reading any mailbox", async () => {
    await run();
    expect(sweepMock.mock.invocationCallOrder[0]).toBeLessThan(
      botFindManyMock.mock.invocationCallOrder[0],
    );
  });

  it("still ingests when the sweep fails", async () => {
    sweepMock.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await run()).deltas).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "Soko Bot leaver integration sweep failed",
      { error: "db down" },
    );
    log.mockRestore();
  });
});
