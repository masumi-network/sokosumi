import { beforeEach, describe, expect, it, vi } from "vitest";

const BOT_ID = "01960001-0001-7001-8001-000000000001";
const COWORKER_ID = "01960001-0001-7001-8001-0000000000c0";

const {
  botFindFirstMock,
  txBotFindFirstMock,
  txBotDeleteMock,
  txBotUpdateMock,
  txCoworkerDeleteMock,
  txCoworkerUpdateMock,
  txTurnUpdateManyMock,
  counts,
  deleteManyCalls,
  revokeIntegrationsMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  txBotFindFirstMock: vi.fn(),
  txBotDeleteMock: vi.fn(),
  txBotUpdateMock: vi.fn(),
  txCoworkerDeleteMock: vi.fn(),
  txCoworkerUpdateMock: vi.fn(),
  txTurnUpdateManyMock: vi.fn(),
  counts: {
    task: 0,
    taskCreatorCoworker: 0,
    taskAssignee: 0,
    taskEvent: 0,
    taskEventCoworker: 0,
    usage: 0,
    chatMessage: 0,
    taskFile: 0,
    coworkerUsage: 0,
  },
  deleteManyCalls: [] as string[],
  revokeIntegrationsMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findFirst: botFindFirstMock } },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  revokeAllSokoBotIntegrations: revokeIntegrationsMock,
}));

function deleteManyRecorder(table: string) {
  return vi.fn(async () => {
    deleteManyCalls.push(table);
    return { count: 0 };
  });
}

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: vi.fn(async (operation: (tx: unknown) => unknown) =>
    operation({
      $queryRaw: vi.fn(),
      sokoBot: {
        findFirst: txBotFindFirstMock,
        delete: txBotDeleteMock,
        update: txBotUpdateMock,
      },
      coworker: { delete: txCoworkerDeleteMock, update: txCoworkerUpdateMock },
      sokoBotTurn: {
        updateMany: txTurnUpdateManyMock,
        deleteMany: deleteManyRecorder("turns"),
      },
      sokoBotMemoryRevision: { deleteMany: deleteManyRecorder("memory") },
      sokoBotSchedule: { deleteMany: deleteManyRecorder("schedules") },
      sokoBotIntegration: { deleteMany: deleteManyRecorder("integrations") },
      sokoBotInstalledSkill: { deleteMany: deleteManyRecorder("skills") },
      sokoBotLabRun: { deleteMany: deleteManyRecorder("labRuns") },
      sokoBotNudge: { deleteMany: deleteManyRecorder("nudges") },
      sokoBotTaskWatch: { deleteMany: deleteManyRecorder("watches") },
      sokoBotPendingDecision: { deleteMany: deleteManyRecorder("decisions") },
      sokoBotLegacyMessage: { deleteMany: deleteManyRecorder("legacy") },
      task: {
        count: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if ("creatorOrchestratorId" in args.where) return counts.task;
          if ("creatorCoworkerId" in args.where)
            return counts.taskCreatorCoworker;
          return counts.taskAssignee;
        }),
      },
      taskEvent: {
        count: vi.fn(async (args: { where: Record<string, unknown> }) =>
          "orchestratorId" in args.where
            ? counts.taskEvent
            : counts.taskEventCoworker,
        ),
      },
      orchestratorUsage: { count: vi.fn(async () => counts.usage) },
      chatRoomMessage: { count: vi.fn(async () => counts.chatMessage) },
      taskFile: { count: vi.fn(async () => counts.taskFile) },
      coworkerUsage: { count: vi.fn(async () => counts.coworkerUsage) },
    }),
  ),
}));

import { deleteSokoBot } from "./soko-bot-deletion.service";

describe("deleteSokoBot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteManyCalls.length = 0;
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      counts[key] = 0;
    }
    revokeIntegrationsMock.mockResolvedValue({ revoked: 0, failed: [] });
    txBotFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      coworker: { id: COWORKER_ID },
    });
  });

  it("removes the row outright when nothing references the bot", async () => {
    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("deleted");
    expect(txBotDeleteMock).toHaveBeenCalledWith({ where: { id: BOT_ID } });
    expect(txCoworkerDeleteMock).toHaveBeenCalledWith({
      where: { id: COWORKER_ID },
    });
    expect(txBotUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps a tombstone when Tasks still reference the bot", async () => {
    counts.task = 178;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.tasks).toBe(178);
    expect(txBotDeleteMock).not.toHaveBeenCalled();
    const data = txBotUpdateMock.mock.calls[0]?.[0]?.data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    // The tombstone must carry nothing the owner would recognise as their bot.
    expect(data.name).toBeNull();
    expect(data.avatarSeed).toBeNull();
    expect(data.memoryHash).toBeNull();
    expect(data.versionId).toBeNull();
  });

  it("tombstones for billing usage alone, so payment records survive", async () => {
    counts.usage = 261;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.billingRecords).toBe(261);
  });

  it("keeps the coworker as a renamed tombstone when it authored chat", async () => {
    counts.chatMessage = 52;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(txCoworkerDeleteMock).not.toHaveBeenCalled();
    expect(txCoworkerUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COWORKER_ID },
        data: expect.objectContaining({ name: "Deleted assistant" }),
      }),
    );
  });

  it("erases everything the bot owned on either path", async () => {
    counts.task = 4;

    await deleteSokoBot(BOT_ID);

    expect(deleteManyCalls).toEqual(
      expect.arrayContaining([
        "turns",
        "memory",
        "schedules",
        "integrations",
        "skills",
        "labRuns",
        "nudges",
        "watches",
        "decisions",
        "legacy",
      ]),
    );
  });

  it("cancels live work before erasing what it would write into", async () => {
    await deleteSokoBot(BOT_ID);

    expect(txTurnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCEL_REQUESTED" }),
      }),
    );
    const cancelOrder = txTurnUpdateManyMock.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(
      txBotDeleteMock.mock.invocationCallOrder[0],
    );
  });

  it("refuses a bot that is already a tombstone", async () => {
    txBotFindFirstMock.mockResolvedValue(null);

    await expect(deleteSokoBot(BOT_ID)).rejects.toThrow();
  });
});
