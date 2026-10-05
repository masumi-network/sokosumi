import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskFindManyMock,
  userFindUniqueMock,
  memoryFindFirstMock,
  integrationsMock,
  calendarMock,
  inboxMock,
  chargedMock,
} = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memoryFindFirstMock: vi.fn(),
  integrationsMock: vi.fn(),
  calendarMock: vi.fn(),
  inboxMock: vi.fn(),
  chargedMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: taskFindManyMock },
    user: { findUnique: userFindUniqueMock },
    sokoBotMemoryRevision: { findFirst: memoryFindFirstMock },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: integrationsMock,
  fetchCalendarEvents: calendarMock,
  fetchInboxMessages: inboxMock,
}));
vi.mock("@/lib/soko-bot/task-charges", () => ({
  taskCreditsCharged: chargedMock,
  roundCredits: (n: number) => Math.round(n * 100) / 100,
}));
const { statsMock } = vi.hoisted(() => ({ statsMock: vi.fn() }));
vi.mock("@/services/soko-bot-activity-stats.service", async (original) => ({
  ...(await original<
    typeof import("@/services/soko-bot-activity-stats.service")
  >()),
  activityStats: statsMock,
}));

import { buildRhythmPacket, dueSoonBlock } from "./soko-bot-rhythms.service";

const bot = {
  id: "bot-1",
  userId: "user-1",
  workspaceId: "ws-1",
  ingestTimezone: "UTC",
};
const gmail = { provider: { id: "gmail" } };

function event(overrides: Record<string, unknown>) {
  return {
    provider: "googlecalendar",
    id: "ev-1",
    title: "Intro call",
    startsAt: "2026-10-01T10:40:00.000Z",
    endsAt: null,
    allDay: false,
    location: null,
    attendees: ["patrick@nmkr.io", "anna@acme.com"],
    organizer: null,
    description: null,
    link: null,
    ...overrides,
  };
}

function message(overrides: Record<string, unknown>) {
  return {
    provider: "gmail",
    id: "m-1",
    threadId: "t-1",
    from: "Anna <anna@acme.com>",
    to: ["patrick@nmkr.io"],
    subject: "Can we meet?",
    snippet: "Does Thursday work?",
    receivedAt: "2026-09-25T09:00:00.000Z",
    unread: true,
    labels: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  taskFindManyMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue({ email: "patrick@nmkr.io" });
  memoryFindFirstMock.mockResolvedValue(null);
  integrationsMock.mockResolvedValue([gmail]);
  calendarMock.mockResolvedValue([]);
  inboxMock.mockResolvedValue([]);
  chargedMock.mockResolvedValue(new Map());
});

describe("meeting prep", () => {
  // Slot 10:00–10:30 reads meetings starting 10:30–11:00.
  const slotAt = new Date("2026-10-01T10:00:00.000Z");

  it("briefs an external meeting in its window with mail and related Tasks", async () => {
    calendarMock.mockResolvedValue([event({})]);
    inboxMock.mockResolvedValue([message({})]);
    taskFindManyMock.mockResolvedValue([
      { id: "task-1", name: "Acme proposal", status: "RUNNING" },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(packet.skip).toBe(false);
    const text = packet.lines.join("\n");
    expect(text).toContain("Intro call");
    expect(text).toContain("From outside: anna@acme.com");
    expect(text).toContain("Can we meet?");
    expect(text).toContain('"Acme proposal"');
    expect(calendarMock).toHaveBeenCalledWith(gmail, {
      from: new Date("2026-10-01T10:30:00.000Z"),
      to: new Date("2026-10-01T11:00:00.000Z"),
      limit: 10,
    });
  });

  it("searches a year of mail per person and drops calendar notices", async () => {
    calendarMock.mockResolvedValue([
      event({
        attendees: ["patrick@nmkr.io", "ingo@hoc.de", "andric@hoc.de"],
      }),
    ]);
    inboxMock.mockImplementation(async (_integration, options) =>
      options.query.includes("andric@hoc.de")
        ? [
            message({
              id: "m-2",
              from: "Andric <andric@hoc.de>",
              subject: "Re: Masumi deck",
              receivedAt: "2026-06-02T09:00:00.000Z",
            }),
          ]
        : [
            message({
              from: "Ingo <ingo@hoc.de>",
              subject: "Accepted: Next Steps Masumi @ Thu 2 Oct",
            }),
          ],
    );
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    const text = packet.lines.join("\n");
    expect(inboxMock).toHaveBeenCalledWith(gmail, {
      query:
        "{from:andric@hoc.de to:andric@hoc.de cc:andric@hoc.de} -filename:ics",
      since: new Date("2025-10-01T10:00:00.000Z"),
      limit: 8,
    });
    expect(text).toContain("Last mail with andric@hoc.de:");
    expect(text).toContain("Re: Masumi deck");
    expect(text).toContain("No mail with ingo@hoc.de by address");
    expect(text).not.toContain("Accepted:");
  });

  it("searches Outlook by participant", async () => {
    const outlook = { provider: { id: "outlook" } };
    integrationsMock.mockResolvedValue([outlook]);
    calendarMock.mockResolvedValue([event({})]);
    await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(inboxMock).toHaveBeenCalledWith(
      outlook,
      expect.objectContaining({ query: "participants:anna@acme.com" }),
    );
  });

  it("skips internal meetings and meetings outside the window", async () => {
    calendarMock.mockResolvedValue([
      event({ attendees: ["patrick@nmkr.io", "albina@nmkr.io"] }),
      event({ id: "ev-2", startsAt: "2026-10-01T11:10:00.000Z" }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(packet).toEqual({ lines: [], skip: true });
  });

  it("skips without a calendar", async () => {
    integrationsMock.mockResolvedValue([]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.skip).toBe(true);
  });
});

describe("end of day", () => {
  it("is silent when nothing happened and nothing waits", async () => {
    const packet = await buildRhythmPacket({
      key: "end-of-day",
      bot,
      now: new Date("2026-10-01T17:30:00.000Z"),
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(packet.skip).toBe(true);
  });

  it("lists what got done, what waits and tomorrow", async () => {
    taskFindManyMock
      .mockResolvedValueOnce([
        { name: "Ship brief", assignee: { name: "Hannah" } },
      ])
      .mockResolvedValueOnce([
        { id: "task-2", name: "Budget", assignee: { name: "Jamal" } },
      ]);
    calendarMock.mockResolvedValue([
      event({ title: "Board sync", startsAt: "2026-10-02T09:00:00.000Z" }),
    ]);
    const packet = await buildRhythmPacket({
      key: "end-of-day",
      bot,
      now: new Date("2026-10-01T17:30:00.000Z"),
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    const text = packet.lines.join("\n");
    expect(text).toContain('## Done today\n- "Ship brief" · Hannah');
    expect(text).toContain('"Budget" (id task-2) · asked by Jamal');
    expect(text).toContain("Board sync");
  });
});

describe("follow-up chaser", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  it("skips when no mailbox is connected", async () => {
    integrationsMock.mockResolvedValue([]);
    const packet = await buildRhythmPacket({
      key: "follow-ups",
      bot,
      now,
      dayStart: now,
    });
    expect(packet.skip).toBe(true);
  });

  it("finds questions waiting on the owner and sent mail without a reply", async () => {
    inboxMock.mockImplementation(
      async (_integration: unknown, options: { query?: string }) => {
        if (options.query?.startsWith("in:sent"))
          return [
            message({
              id: "s-1",
              threadId: "t-sent",
              from: "patrick@nmkr.io",
              to: ["bob@bigco.com"],
              subject: "Proposal",
              receivedAt: "2026-09-24T09:00:00.000Z",
            }),
            message({
              id: "s-2",
              threadId: "t-replied",
              from: "patrick@nmkr.io",
              subject: "Answered",
              receivedAt: "2026-09-24T09:00:00.000Z",
            }),
          ];
        return [
          message({}),
          message({
            id: "m-2",
            threadId: "t-replied",
            subject: "Re: Answered",
            snippet: "thanks",
            receivedAt: "2026-09-25T09:00:00.000Z",
          }),
        ];
      },
    );
    const packet = await buildRhythmPacket({
      key: "follow-ups",
      bot,
      now,
      dayStart: now,
    });
    const text = packet.lines.join("\n");
    expect(text).toContain("## Waiting on you");
    expect(text).toContain("Can we meet?");
    expect(text).toContain("to bob@bigco.com");
    expect(text).not.toContain("**Answered**");
  });
});

describe("monthly review", () => {
  it("leads with the month's numbers for the owner, the bot and the team", async () => {
    statsMock.mockResolvedValue({
      own: { created: 12, completed: 9, failed: 1, viaBot: 4 },
      ownerMessages: 42,
      botTurns: 120,
      botMessages: 80,
      botCredits: 45.5,
      coworkerCredits: [
        { name: "Hannah", credits: 121.31 },
        { name: "Jamal", credits: 50 },
      ],
      team: [{ name: "Albina", completed: 5, created: 7 }],
    });
    inboxMock.mockResolvedValue([]);
    const packet = await buildRhythmPacket({
      key: "monthly-review",
      bot: { ...bot, name: "Jarvis" },
      now: new Date("2026-10-01T09:00:00.000Z"),
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    const text = packet.lines.join("\n");
    expect(statsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bot-1" }),
      new Date("2026-08-31T00:00:00.000Z"),
      new Date("2026-10-01T00:00:00.000Z"),
    );
    expect(text).toContain("## Last 31 days in numbers");
    expect(text).toContain(
      "- Your Tasks: 12 created, 9 completed, 1 failed (4 completed through Jarvis)",
    );
    expect(text).toContain(
      "- Chat: you sent 42 messages; Jarvis ran 120 turns and posted 80 messages",
    );
    expect(text).toContain(
      "- Credits: 216.81 in total, 45.5 for Jarvis, Hannah 121.31, Jamal 50",
    );
    expect(text).toContain("- Team: Albina 5 completed / 7 created");
  });
});

describe("memory cleanup and deadline watch", () => {
  beforeEach(() => {
    memoryFindFirstMock.mockResolvedValue({
      markdown:
        "# Soko Bot memory\n\n## Follow-ups\n- 2026-09-01 old check-in\n- 2026-10-02 send the agenda\n- 2026-10-20 renew domain\n",
    });
  });

  it("lists follow-ups dated more than a week ago", async () => {
    const packet = await buildRhythmPacket({
      key: "memory-cleanup",
      bot,
      now: new Date("2026-10-01T18:00:00.000Z"),
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    const text = packet.lines.join("\n");
    expect(text).toContain("old check-in");
    expect(text).not.toContain("renew domain");
  });

  it("flags only what is due in the next 48 hours", async () => {
    const block = await dueSoonBlock(bot, new Date("2026-10-01T06:00:00.000Z"));
    expect(block.join("\n")).toContain("send the agenda");
    expect(block.join("\n")).not.toContain("renew domain");
  });
});
