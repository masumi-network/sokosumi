import { TaskVisibility } from "@sokosumi/database";
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
    sokoBotNudge: { findMany: nudgeFindManyMock },
    task: { findMany: taskFindManyMock },
  },
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  fetchInboxMessages: vi.fn(),
}));

import {
  buildSystemBeatMessage,
  proactiveGate,
} from "./soko-bot-proactive.service";

const ALICE_USER_ID = "alice-user";
const ALICE_BOT_ID = "alice-bot";
const ALICE_WORKSPACE_ID = "org-workspace";

function whereHasOwnerVisibility(where: unknown, userId: string): boolean {
  if (!where || typeof where !== "object") return false;
  const and = (where as { AND?: unknown }).AND;
  if (!Array.isArray(and)) return false;
  const expected = JSON.stringify(buildSokoBotOwnerTaskVisibilityWhere(userId));
  return and.some((clause) => JSON.stringify(clause) === expected);
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
          AND: [buildSokoBotOwnerTaskVisibilityWhere(ALICE_USER_ID)],
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { visibility: TaskVisibility.PUBLIC },
                {
                  visibility: TaskVisibility.PRIVATE,
                  ownerId: ALICE_USER_ID,
                },
              ],
            },
          ],
        }),
      }),
    );
    expect(beat.message).toContain("Public launch");
    expect(beat.message).toContain("public-1");
    expect(beat.message).not.toContain("Secret acquisition");
    expect(beat.message).not.toContain("secret-1");
  });
});
