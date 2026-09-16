import { isDeepStrictEqual } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";

const {
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
  stampNudges: vi.fn(),
}));

import {
  buildTaskboardMessage,
  isRelevantBoardComment,
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

describe("isRelevantBoardComment", () => {
  const memoryTokens = new Set(["marketplace", "launch"]);
  it("lets through mentions, questions, and memory overlap only", () => {
    expect(
      isRelevantBoardComment({
        comment: "Atlas, can you check?",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(true);
    expect(
      isRelevantBoardComment({
        comment: "Which currency should we use?",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(true);
    expect(
      isRelevantBoardComment({
        comment: "Draft done for the marketplace page.",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(true);
    expect(
      isRelevantBoardComment({
        comment: "Looks good, shipping it.",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(false);
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
            comment: "Which marketplace copy should we ship?",
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
    expect(startedMessage).toContain("Which marketplace copy should we ship?");
    expect(startedMessage).not.toContain("Secret acquisition");
    expect(startedMessage).not.toContain("secret-1");
    expect(startedMessage).not.toContain("Offer terms are confidential");
  });
});
