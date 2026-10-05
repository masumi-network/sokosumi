import { isDeepStrictEqual } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";

const {
  botFindUniqueOrThrowMock,
  delegationFindManyMock,
  getEnvMock,
  memoryFindFirstMock,
  nudgeFindManyMock,
  taskFindManyMock,
  turnCountMock,
} = vi.hoisted(() => ({
  botFindUniqueOrThrowMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  memoryFindFirstMock: vi.fn(),
  nudgeFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  turnCountMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findUniqueOrThrow: botFindUniqueOrThrowMock },
    sokoBotTurn: { count: turnCountMock },
    sokoBotDelegation: { findMany: delegationFindManyMock },
    sokoBotMemoryRevision: { findFirst: memoryFindFirstMock },
    sokoBotNudge: {
      findMany: nudgeFindManyMock,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    task: { findMany: taskFindManyMock },
  },
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

vi.mock("@/services/soko-bot-activity-stats.service", () => ({
  activityStats: vi.fn().mockResolvedValue(null),
  activityStatsLines: () => ["## This week in numbers", "- (stats)", ""],
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  fetchInboxMessages: vi.fn(),
}));

import {
  buildSystemBeatMessage,
  findAttentionItems,
  followUpsBlock,
  proactiveGate,
} from "./soko-bot-proactive.service";

describe("followUpsBlock", () => {
  const ARCHIVED = "01a0efbb-778c-7669-86b6-d50d81e74287";
  const OPEN = "01a0efbb-778c-7669-86b6-d50d81e74288";
  const KEANUS = "01a08162-3b3b-7099-825a-8a9b987034dc";
  const owner = { id: "bot-1", userId: "andreas" };
  const task = (id: string, extra: Record<string, unknown>) => ({
    id,
    name: "A task",
    status: "INPUT_REQUIRED",
    archivedAt: null,
    ownerId: "andreas",
    assigneeSokoBotId: null,
    owner: { name: "Andreas" },
    ...extra,
  });

  it("drops due follow-ups about closed Tasks and other people's Tasks", async () => {
    memoryFindFirstMock.mockResolvedValue({
      markdown: [
        "# Soko Bot memory",
        "## Follow-ups",
        `- 2026-09-29 check Hannah's estimate on ${ARCHIVED}`,
        `- 2026-09-29 chase the review on ${OPEN}`,
        `- 2026-09-29 resolve INPUT_REQUIRED on Themis task ${KEANUS}`,
        "- 2026-09-29 call the venue",
      ].join("\n\n"),
    });
    taskFindManyMock.mockResolvedValue([
      task(ARCHIVED, { archivedAt: new Date() }),
      task(OPEN, {}),
      task(KEANUS, {
        name: "Create greeting message",
        ownerId: "keanu",
        owner: { name: "Keanu Klestil" },
      }),
    ]);

    const text = (
      await followUpsBlock(
        owner,
        "Europe/Vienna",
        new Date("2026-09-30T08:00:00Z"),
      )
    ).join("\n");

    expect(text).not.toContain(`estimate on ${ARCHIVED}`);
    expect(text).toContain(OPEN);
    expect(text).toContain("call the venue");
    // Keanu's Task is named as his, never raised as the owner's follow-up.
    expect(text).not.toContain("resolve INPUT_REQUIRED on Themis");
    expect(text).toContain(
      `"Create greeting message" (id ${KEANUS}) belongs to Keanu Klestil.`,
    );
  });
});

const ALICE_USER_ID = "alice-user";
const ALICE_BOT_ID = "alice-bot";
const ALICE_WORKSPACE_ID = "org-workspace";

function whereHasOwnerVisibility(where: unknown, userId: string): boolean {
  if (!where || typeof where !== "object") return false;
  const and = (where as { AND?: unknown }).AND;
  if (!Array.isArray(and)) return false;
  const expected = buildSokoBotOwnerTaskVisibilityWhere(userId);
  return and.some((clause) => isDeepStrictEqual(clause, expected));
}

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
  delegationFindManyMock.mockResolvedValue([]);
  nudgeFindManyMock.mockResolvedValue([]);
  memoryFindFirstMock.mockResolvedValue(null);
  taskFindManyMock.mockResolvedValue([]);
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

describe("buildSystemBeatMessage private Task visibility", () => {
  it("does not ingest Bob's PRIVATE task into Alice's followWholeBoard open-board list", async () => {
    const publicTask = {
      id: "public-1",
      name: "Public launch",
      status: "READY",
      assignee: { name: "Alice" },
    };
    const secretTask = {
      id: "secret-1",
      name: "Secret acquisition",
      status: "READY",
      assignee: { name: "Bob" },
    };
    taskFindManyMock.mockImplementation(
      async (args: { where?: { status?: { notIn?: unknown } } }) => {
        if (!args.where?.status || !("notIn" in args.where.status)) {
          return [];
        }
        if (whereHasOwnerVisibility(args.where, ALICE_USER_ID)) {
          return [publicTask];
        }
        return [publicTask, secretTask];
      },
    );

    const beat = await buildSystemBeatMessage({
      bot: {
        id: ALICE_BOT_ID,
        userId: ALICE_USER_ID,
        workspaceId: ALICE_WORKSPACE_ID,
        ingestTimezone: "Europe/Vienna",
        followWholeBoard: true,
      },
      key: "weekly-wrap",
      prompt: "Weekly wrap.",
      now: new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: ALICE_WORKSPACE_ID,
          archivedAt: null,
          AND: expect.arrayContaining([
            buildSokoBotOwnerTaskVisibilityWhere(ALICE_USER_ID),
          ]),
        }),
      }),
    );
    expect(beat.message).toContain("Public launch");
    expect(beat.message).toContain("public-1");
    expect(beat.message).not.toContain("Secret acquisition");
    expect(beat.message).not.toContain("secret-1");
  });
});

describe("buildSystemBeatMessage stand-up board", () => {
  it("lists only the owner's open Tasks and adds a short team note", async () => {
    const integrations = await import(
      "@/services/soko-bot-integrations.service"
    );
    vi.mocked(integrations.activeIntegrationsForBot).mockResolvedValue([]);
    taskFindManyMock.mockImplementation(
      async (args: {
        where?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        // The attention query has its own shape; nothing is stuck here.
        if (args.select?.events) return [];
        if (args.where?.OR) {
          return [
            {
              id: "mine-1",
              name: "My launch",
              status: "READY",
              assignee: null,
            },
          ];
        }
        if (args.where?.NOT) {
          return [
            {
              name: "Pricing research",
              status: "RUNNING",
              owner: { name: "Albina" },
              assignee: { name: "Hannah" },
            },
          ];
        }
        return [];
      },
    );
    const beat = await buildSystemBeatMessage({
      bot: {
        id: ALICE_BOT_ID,
        userId: ALICE_USER_ID,
        workspaceId: ALICE_WORKSPACE_ID,
        ingestTimezone: "Europe/Vienna",
        followWholeBoard: true,
      },
      key: "standup",
      prompt: "Daily stand-up.",
      now: new Date("2026-09-16T06:00:00.000Z"),
    });
    const own = {
      OR: [{ ownerId: ALICE_USER_ID }, { assigneeSokoBotId: ALICE_BOT_ID }],
    };
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining(own) }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: own,
          AND: expect.arrayContaining([
            buildSokoBotOwnerTaskVisibilityWhere(ALICE_USER_ID),
          ]),
        }),
      }),
    );
    expect(beat.message).toContain("## Your open Tasks");
    expect(beat.message).toContain("My launch");
    expect(beat.message).toContain("## Team activity (last 24h)");
    expect(beat.message).toContain(
      'Albina · RUNNING · "Pricing research" · with Hannah',
    );
  });
});

describe("findAttentionItems ownership", () => {
  it("only chases the owner's Tasks from turns the owner asked for or the bot started", async () => {
    delegationFindManyMock.mockResolvedValue([{ taskId: "t1" }]);
    taskFindManyMock.mockResolvedValue([]);
    await findAttentionItems({
      id: "bot-1",
      userId: "andreas",
      workspaceId: "ws",
      followWholeBoard: true,
      now: new Date("2026-10-01T08:00:00Z"),
    });
    expect(delegationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          turn: {
            sokoBotId: "bot-1",
            OR: [{ requestedByUserId: null }, { requestedByUserId: "andreas" }],
          },
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "andreas" }),
      }),
    );
  });
});
