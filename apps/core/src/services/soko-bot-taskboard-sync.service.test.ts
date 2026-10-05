import { isDeepStrictEqual } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";

const {
  metadataUpsertMock,
  metadataUpdateMock,
  inboxFindManyMock,
  botFindManyMock,
  delegationFindManyMock,
  eventFindManyMock,
  findAttentionItemsMock,
  followUpsBlockMock,
  proactiveGateMock,
  startTurnMock,
  taskFindManyMock,
  watchUpsertMock,
} = vi.hoisted(() => ({
  metadataUpsertMock: vi.fn().mockResolvedValue({
    key: "board",
    cursorId: null,
    createdAt: new Date(0),
  }),
  metadataUpdateMock: vi.fn(),
  inboxFindManyMock: vi.fn().mockResolvedValue([]),
  botFindManyMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
  eventFindManyMock: vi.fn(),
  findAttentionItemsMock: vi.fn(),
  followUpsBlockMock: vi.fn(),
  proactiveGateMock: vi.fn(),
  startTurnMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  watchUpsertMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    syncMetadata: { upsert: metadataUpsertMock, update: metadataUpdateMock },
    sokoBotEventInbox: { findMany: inboxFindManyMock },
    sokoBot: { findMany: botFindManyMock },
    sokoBotDelegation: { findMany: delegationFindManyMock },
    sokoBotTaskWatch: { upsert: watchUpsertMock },
    task: { findMany: taskFindManyMock },
    taskEvent: { findMany: eventFindManyMock },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class extends Error {},
  sokoBotControlPlane: {
    startTurn: startTurnMock,
    reconcileTurn: vi.fn(),
  },
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  attentionBlock: () => [],
  ensureSystemSchedules: vi.fn(),
  findAttentionItems: findAttentionItemsMock,
  followUpsBlock: followUpsBlockMock,
  proactiveGate: proactiveGateMock,
  stageSokoBotNudges: vi.fn(),
}));

import { commentNamesBot } from "@/lib/soko-bot/task-involvement";

import {
  buildTaskboardMessage,
  SokoBotTaskboardSyncService,
} from "./soko-bot-taskboard-sync.service";

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

describe("buildTaskboardMessage", () => {
  it("separates work handed to the bot from updates it only follows", () => {
    const message = buildTaskboardMessage([
      {
        taskId: "t1",
        name: "Write launch brief",
        status: "READY",
        assignedToBot: true,
        work: true,
        events: [
          {
            at: new Date(),
            by: "Patrick",
            status: "READY",
            comment: "Keep it to one page.",
          },
        ],
      },
      {
        taskId: "t2",
        name: "Pricing research",
        status: "RUNNING",
        assignedToBot: false,
        work: false,
        events: [
          {
            at: new Date(),
            by: "Coworker Ada",
            status: null,
            comment: "Which currency should I use?",
          },
        ],
      },
    ]);
    expect(message).toContain("## Tasks assigned to you");
    expect(message).toContain(
      '"Write launch brief" (id t1) is READY and waiting for you.',
    );
    expect(message).toContain("Patrick set READY: Keep it to one page.");
    expect(message).toContain("## New on Tasks you follow");
    expect(message).toContain("Coworker Ada: Which currency should I use?");
    expect(message).toContain("Nothing to add.");
  });
});

describe("commentNamesBot", () => {
  it("matches the name as a whole word only", () => {
    expect(commentNamesBot("Atlas, can you check?", "Atlas")).toBe(true);
    expect(commentNamesBot("@atlas please look", "Atlas")).toBe(true);
    expect(commentNamesBot("Which currency should we use?", "Atlas")).toBe(
      false,
    );
    expect(commentNamesBot("See the Atlassian page", "Atlas")).toBe(false);
    expect(commentNamesBot("Anyone?", null)).toBe(false);
  });
});

describe("SokoBotTaskboardSyncService private Task visibility", () => {
  it("does not ingest Bob's PRIVATE task name/id/comments into Alice's followWholeBoard sync", async () => {
    const publicTask = {
      id: "public-1",
      name: "Public launch",
      status: "READY",
      assigneeId: null,
      assigneeSokoBotId: null,
      updatedAt: new Date(),
      sokoBotDelegations: [],
      sokoBotWatches: [
        {
          id: "watch-public",
          lastSeenEventAt: new Date("2026-09-01T00:00:00.000Z"),
          lastSeenStatus: "READY",
        },
      ],
    };
    const secretTask = {
      id: "secret-1",
      name: "Secret acquisition",
      status: "READY",
      assigneeId: null,
      assigneeSokoBotId: null,
      updatedAt: new Date(),
      sokoBotDelegations: [],
      sokoBotWatches: [
        {
          id: "watch-secret",
          lastSeenEventAt: new Date("2026-09-01T00:00:00.000Z"),
          lastSeenStatus: "READY",
        },
      ],
    };
    botFindManyMock.mockResolvedValue([
      {
        id: ALICE_BOT_ID,
        name: "Atlas",
        userId: ALICE_USER_ID,
        workspaceId: ALICE_WORKSPACE_ID,
        followWholeBoard: true,
        ingestTimezone: "Europe/Vienna",
        memoryRevisions: [{ markdown: "# Soko Bot memory" }],
      },
    ]);
    delegationFindManyMock.mockResolvedValue([]);
    findAttentionItemsMock.mockResolvedValue([]);
    followUpsBlockMock.mockResolvedValue([]);
    proactiveGateMock.mockResolvedValue({ ok: true });
    startTurnMock.mockResolvedValue({
      turnId: "turn-1",
      status: "RUNNING",
    });
    watchUpsertMock.mockResolvedValue({});
    taskFindManyMock.mockImplementation(
      async (args: { where?: Record<string, unknown> }) => {
        if (whereHasOwnerVisibility(args.where, ALICE_USER_ID)) {
          return [publicTask];
        }
        return [publicTask, secretTask];
      },
    );
    eventFindManyMock.mockImplementation(
      async (args: { where?: { taskId?: string } }) => {
        if (args.where?.taskId === "secret-1") {
          return [
            {
              createdAt: new Date(),
              status: null,
              comment: "Offer terms are confidential. Atlas?",
              userId: "bob-user",
              coworkerId: null,
              sokoBotId: null,
              user: { name: "Bob" },
              coworker: null,
              sokoBot: null,
            },
          ];
        }
        return [
          {
            createdAt: new Date(),
            status: null,
            comment: "Atlas, which marketplace copy should we ship?",
            userId: ALICE_USER_ID,
            coworkerId: null,
            sokoBotId: null,
            user: { name: "Alice" },
            coworker: null,
            sokoBot: null,
          },
        ];
      },
    );

    await new SokoBotTaskboardSyncService().syncTaskboard({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
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
    expect(eventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskId: "public-1" }),
      }),
    );
    expect(eventFindManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskId: "secret-1" }),
      }),
    );

    const startedMessage = startTurnMock.mock.calls[0]?.[0]?.message as string;
    expect(startedMessage).toContain("Public launch");
    expect(startedMessage).toContain("public-1");
    expect(startedMessage).toContain(
      "Atlas, which marketplace copy should we ship?",
    );
    expect(startedMessage).not.toContain("Secret acquisition");
    expect(startedMessage).not.toContain("secret-1");
    expect(startedMessage).not.toContain("Offer terms are confidential");
  });
});

describe("who a Task comment wakes", () => {
  const at = new Date("2026-09-30T10:00:00Z");
  function task(overrides: Record<string, unknown>) {
    return {
      id: "task-1",
      name: "Launch copy",
      status: "RUNNING",
      ownerId: "someone-else",
      assigneeId: null,
      assigneeSokoBotId: null,
      updatedAt: at,
      sokoBotDelegations: [],
      sokoBotWatches: [
        {
          id: "watch-1",
          lastSeenEventAt: new Date("2026-09-29T00:00:00Z"),
          lastSeenEventId: null,
          lastSeenStatus: "RUNNING",
        },
      ],
      ...overrides,
    };
  }
  function comment(text: string, by: "human" | "bot") {
    return {
      id: `event-${text.length}`,
      createdAt: at,
      status: null,
      comment: text,
      userId: by === "human" ? "teammate" : null,
      coworkerId: null,
      sokoBotId: by === "bot" ? "other-bot" : null,
      user: by === "human" ? { name: "Nina" } : null,
      coworker: null,
      sokoBot:
        by === "bot" ? { name: "Jarvis", user: { name: "Andreas" } } : null,
    };
  }
  async function sync(taskRow: unknown, event: unknown) {
    vi.clearAllMocks();
    botFindManyMock.mockResolvedValue([
      {
        id: ALICE_BOT_ID,
        name: "Atlas",
        userId: ALICE_USER_ID,
        workspaceId: ALICE_WORKSPACE_ID,
        followWholeBoard: true,
        ingestTimezone: "UTC",
      },
    ]);
    metadataUpsertMock.mockResolvedValue({
      key: "board",
      cursorId: null,
      createdAt: new Date(0),
    });
    inboxFindManyMock.mockResolvedValue([]);
    findAttentionItemsMock.mockResolvedValue([]);
    followUpsBlockMock.mockResolvedValue([]);
    proactiveGateMock.mockResolvedValue({ ok: true });
    startTurnMock.mockResolvedValue({ turnId: "turn-1", status: "COMPLETED" });
    taskFindManyMock.mockResolvedValue([taskRow]);
    eventFindManyMock.mockResolvedValue([event]);
    await new SokoBotTaskboardSyncService().syncTaskboard({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });
    return startTurnMock.mock.calls.length > 0;
  }

  it("keeps a board-wide bot out of a question that does not name it", async () => {
    expect(
      await sync(task({}), comment("Which currency should we use?", "human")),
    ).toBe(false);
    expect(
      await sync(task({}), comment("Atlas, which currency?", "human")),
    ).toBe(true);
  });

  it("does not wake a bot on its own Task for another bot's comment", async () => {
    const own = task({
      ownerId: ALICE_USER_ID,
      sokoBotDelegations: [{ id: "delegation-1" }],
    });
    expect(await sync(own, comment("Here are three options.", "bot"))).toBe(
      false,
    );
    expect(await sync(own, comment("Anything else needed?", "human"))).toBe(
      true,
    );
    expect(
      await sync(own, comment("Atlas, can you confirm the budget?", "bot")),
    ).toBe(true);
    // Named with its owner, so it reads as that person's assistant.
    expect(startTurnMock.mock.calls.at(-1)?.[0]?.message).toContain(
      "Jarvis (Andreas's assistant): Atlas, can you confirm the budget?",
    );
  });

  it("follows only Tasks the bot created, assigned or edited", async () => {
    await sync(task({}), comment("x", "human"));
    const where = taskFindManyMock.mock.calls[0]?.[0]?.where as {
      AND: { OR: Record<string, unknown>[] }[];
    };
    expect(where.AND[0]?.OR).toContainEqual(
      expect.objectContaining({
        sokoBotDelegations: {
          some: {
            action: { not: "reply_to_task" },
            turn: { sokoBotId: ALICE_BOT_ID },
          },
        },
      }),
    );
  });
});

describe("taskboard occurrence cursor", () => {
  it("does not re-enqueue a consumed trailing event with an earlier pending event", async () => {
    vi.clearAllMocks();
    const at = new Date("2026-09-26T10:00:00Z");
    botFindManyMock.mockResolvedValue([
      {
        id: ALICE_BOT_ID,
        userId: ALICE_USER_ID,
        workspaceId: ALICE_WORKSPACE_ID,
        name: "Atlas",
        followWholeBoard: true,
        ingestTimezone: "UTC",
        memoryRevisions: [],
      },
    ]);
    delegationFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([
      {
        id: "task-1",
        name: "Task",
        status: "READY",
        assigneeId: null,
        assigneeSokoBotId: ALICE_BOT_ID,
        updatedAt: at,
        sokoBotDelegations: [],
        sokoBotWatches: [
          {
            id: "watch",
            lastSeenEventAt: new Date(0),
            lastSeenEventId: "old",
            lastSeenStatus: "READY",
          },
        ],
      },
    ]);
    eventFindManyMock.mockResolvedValue([
      {
        id: "event-1",
        createdAt: at,
        status: "READY",
        comment: "first",
        userId: "human",
        user: { name: "Human" },
      },
      {
        id: "event-2",
        createdAt: at,
        status: "READY",
        comment: "second",
        userId: "human",
        user: { name: "Human" },
      },
    ]);
    inboxFindManyMock.mockResolvedValue([{ eventId: "event-2" }]);
    findAttentionItemsMock.mockResolvedValue([]);
    followUpsBlockMock.mockResolvedValue([]);
    proactiveGateMock.mockResolvedValue({ ok: true });
    startTurnMock.mockResolvedValue({ turnId: "turn", status: "RUNNING" });
    await new SokoBotTaskboardSyncService().syncTaskboard({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });
    expect(startTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventBatch: [
          expect.objectContaining({ eventId: "event-1", taskCursorAt: at }),
        ],
      }),
    );
    inboxFindManyMock.mockResolvedValue([]);
  });
});

it("baselines assigned historical work and bounds the board page after cutover", async () => {
  vi.clearAllMocks();
  const cutover = new Date("2026-09-26");
  metadataUpsertMock.mockResolvedValue({
    key: "board",
    cursorId: "previous",
    createdAt: cutover,
  });
  botFindManyMock.mockResolvedValue([
    {
      id: ALICE_BOT_ID,
      userId: ALICE_USER_ID,
      workspaceId: ALICE_WORKSPACE_ID,
      name: "Atlas",
      followWholeBoard: true,
      ingestTimezone: "UTC",
      memoryRevisions: [],
    },
  ]);
  taskFindManyMock.mockResolvedValue(
    Array.from({ length: 50 }, (_, i) => ({
      id: `task-${i}`,
      name: "Old task",
      status: "READY",
      updatedAt: new Date("2026-01-01"),
      assigneeSokoBotId: ALICE_BOT_ID,
      sokoBotDelegations: [],
      sokoBotWatches: [],
    })),
  );
  findAttentionItemsMock.mockResolvedValue([]);
  followUpsBlockMock.mockResolvedValue([]);
  await new SokoBotTaskboardSyncService().syncTaskboard({
    abortSignal: new AbortController().signal,
    shouldContinue: () => true,
  });
  expect(taskFindManyMock).toHaveBeenCalledTimes(1);
  expect(taskFindManyMock).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 50,
      where: expect.objectContaining({ id: { gt: "previous" } }),
    }),
  );
  expect(watchUpsertMock).toHaveBeenCalledTimes(50);
  expect(startTurnMock).not.toHaveBeenCalled();
  expect(eventFindManyMock).not.toHaveBeenCalled();
  expect(findAttentionItemsMock).toHaveBeenCalledWith(
    expect.objectContaining({ cutoverAt: cutover }),
  );
  expect(metadataUpdateMock).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ cursorId: "task-49" }),
    }),
  );
});
