import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  historyFloorMock,
  taskFindManyMock,
  userFindUniqueMock,
  memoryFindFirstMock,
  integrationsMock,
  calendarMock,
  inboxMock,
  chargedMock,
  contactLinesMock,
  turnFindManyMock,
  toolCallFindManyMock,
  scheduleRunFindFirstMock,
} = vi.hoisted(() => ({
  historyFloorMock: vi.fn(),
  turnFindManyMock: vi.fn(),
  toolCallFindManyMock: vi.fn(),
  scheduleRunFindFirstMock: vi.fn(),
  contactLinesMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memoryFindFirstMock: vi.fn(),
  integrationsMock: vi.fn(),
  calendarMock: vi.fn(),
  inboxMock: vi.fn(),
  chargedMock: vi.fn(),
}));

vi.mock("@/lib/evals/eval-history", () => ({
  evalHistoryFloor: historyFloorMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: taskFindManyMock },
    user: { findUnique: userFindUniqueMock },
    sokoBotMemoryRevision: { findFirst: memoryFindFirstMock },
    sokoBotTurn: { findMany: turnFindManyMock },
    sokoBotToolCall: { findMany: toolCallFindManyMock },
    sokoBotScheduleRun: { findFirst: scheduleRunFindFirstMock },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: integrationsMock,
  fetchCalendarEvents: calendarMock,
  fetchInboxMessages: inboxMock,
  withOwnerReplies: async (_integration: unknown, messages: unknown) =>
    messages,
}));
vi.mock("@/services/contacts-context.service", () => ({
  contactLinesByEmail: contactLinesMock,
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

import { chatTurnRequest, dreaming } from "./soko-bot-dreaming.service";

const bot = {
  id: "bot-1",
  userId: "user-1",
  workspaceId: "ws-1",
  ingestTimezone: "UTC",
};
const gmail = { provider: { id: "gmail" } };

beforeEach(() => {
  vi.clearAllMocks();
  historyFloorMock.mockResolvedValue(null);
  taskFindManyMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue({ email: "patrick@nmkr.io" });
  memoryFindFirstMock.mockResolvedValue(null);
  integrationsMock.mockResolvedValue([gmail]);
  calendarMock.mockResolvedValue([]);
  inboxMock.mockResolvedValue([]);
  chargedMock.mockResolvedValue(new Map());
  contactLinesMock.mockResolvedValue(new Map());
  turnFindManyMock.mockResolvedValue([]);
  toolCallFindManyMock.mockResolvedValue([]);
  scheduleRunFindFirstMock.mockResolvedValue(null);
});

describe("chatTurnRequest", () => {
  it("drops the chat history in front of a direct message", () => {
    expect(
      chatTurnRequest(
        "CONTEXT (last 2 messages in this chat):\n- Joseph: hi\n- Patrick: yo\n\nNew message:\nAlways file receipts",
      ),
    ).toBe("Always file receipts");
  });

  it("keeps who asked in a room, and a teammate's label", () => {
    expect(
      chatTurnRequest(
        "Albina (a teammate, not your owner) asked: CONTEXT (last 1 messages in #Sokosumi):\n- Andreas: hi\n\nAlbina mentioned you in #Sokosumi:\n\ncan you check?",
      ),
    ).toBe(
      "Albina (a teammate, not your owner) asked: Albina mentioned you in #Sokosumi:\n\ncan you check?",
    );
  });

  it("leaves a plain message alone", () => {
    expect(chatTurnRequest("hello")).toBe("hello");
  });
});

describe("dreaming", () => {
  it("bounds turns, failed tools and saved attachments to the current eval world", async () => {
    const reset = new Date("2026-11-01T02:00:00.000Z");
    historyFloorMock.mockResolvedValue(reset);
    await dreaming(bot, new Date("2026-11-01T03:00:00.000Z"));
    expect(turnFindManyMock.mock.calls[0][0].where.createdAt).toEqual({
      gte: reset,
    });
    expect(
      toolCallFindManyMock.mock.calls.map(([query]) => query.where.createdAt),
    ).toEqual([{ gte: reset }, { gte: reset }]);
  });

  it("keeps a later completed dream checkpoint within the current eval world", async () => {
    const checkpoint = new Date("2026-11-01T02:30:00.000Z");
    historyFloorMock.mockResolvedValue(new Date("2026-11-01T02:00:00.000Z"));
    scheduleRunFindFirstMock.mockResolvedValue({ scheduledFor: checkpoint });
    await dreaming(bot, new Date("2026-11-01T03:00:00.000Z"));
    expect(turnFindManyMock.mock.calls[0][0].where.createdAt).toEqual({
      gte: checkpoint,
    });
  });

  const now = new Date("2026-11-01T03:00:00.000Z");
  const turn = (overrides: Record<string, unknown>) => ({
    createdAt: new Date("2026-10-31T14:00:00.000Z"),
    source: "CHAT",
    status: "COMPLETED",
    userMessage: "",
    finalAnswer: null,
    errorKind: null,
    errorDetail: null,
    ownerFeedback: null,
    qualityVerdict: null,
    backgroundTitle: null,
    ...overrides,
  });
  const dream = async () => await dreaming(bot, now);

  it("sleeps without a turn when nothing happened and nothing is stale", async () => {
    expect(await dream()).toEqual({ lines: [], skip: true });
  });

  it("looks back to the last dream, at most a week", async () => {
    scheduleRunFindFirstMock.mockResolvedValue({
      scheduledFor: new Date("2026-10-31T03:00:00.000Z"),
    });
    await dream();
    expect(turnFindManyMock.mock.calls[0][0].where.createdAt.gte).toEqual(
      new Date("2026-10-31T03:00:00.000Z"),
    );
    scheduleRunFindFirstMock.mockResolvedValue({
      scheduledFor: new Date("2026-09-01T03:00:00.000Z"),
    });
    await dream();
    expect(turnFindManyMock.mock.calls[1][0].where.createdAt.gte).toEqual(
      new Date("2026-10-25T03:00:00.000Z"),
    );
  });

  it("quotes chats with the owner's thumbs, and only counts packet-driven turns", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        createdAt: new Date("2026-10-31T15:00:00.000Z"),
        userMessage: "No, always file receipts too",
        finalAnswer: "Noted.",
        ownerFeedback: -1,
      }),
      turn({ source: "INGEST", userMessage: "## Mail\n- secret packet" }),
      turn({
        source: "SCHEDULE",
        status: "FAILED",
        errorKind: "timeout",
        userMessage: "Weekly wrap…",
      }),
    ]);
    const text = (await dream()).lines.join("\n");
    expect(text).toContain(
      "3 turns: 1 chats, 1 inbox checks, 1 scheduled, 0 Task events; 1 failed.",
    );
    expect(text).toContain(
      'Asked: "No, always file receipts too" → You: "Noted." [thumbs down]',
    );
    expect(text).not.toContain("secret packet");
    expect(text).toContain("## Turns that failed");
    expect(text).toContain("schedule: timeout");
  });

  it("groups failing tools so a repeat shows, and lists weak answers and saved attachments", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        qualityVerdict: {
          verdict: "fail",
          issues: ["Claimed a Task was created without a tool result"],
        },
      }),
    ]);
    toolCallFindManyMock.mockImplementation(async ({ where }) =>
      where.status === "FAILED"
        ? [
            {
              capability: "read_email",
              errorKind: "provider_error",
              errorDetail: "429",
            },
            {
              capability: "read_email",
              errorKind: "provider_error",
              errorDetail: "429",
            },
          ]
        : [
            { input: { folder: "Finance/Invoices" } },
            { input: { folder: "Finance/Invoices" } },
          ],
    );
    const text = (await dream()).lines.join("\n");
    expect(text).toContain("- read_email (provider_error) ×2: 429");
    expect(text).toContain(
      "fail: Claimed a Task was created without a tool result",
    );
    expect(text).toContain("Finance/Invoices ×2");
  });
});
