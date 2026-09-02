import { beforeEach, describe, expect, it, vi } from "vitest";

const BOT_ID = "01960001-0001-7001-8001-000000000001";

const {
  botFindFirstMock,
  txBotFindFirstMock,
  txBotDeleteMock,
  txBotUpdateMock,
  txOrchestratorMemberDeleteManyMock,
  txTurnUpdateManyMock,
  failOpenMentionsMock,
  publishMentionStatusesMock,
  counts,
  deleteManyCalls,
  revokeIntegrationsMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  txBotFindFirstMock: vi.fn(),
  txBotDeleteMock: vi.fn(),
  txBotUpdateMock: vi.fn(),
  txOrchestratorMemberDeleteManyMock: vi.fn(),
  txTurnUpdateManyMock: vi.fn(),
  failOpenMentionsMock: vi.fn(),
  publishMentionStatusesMock: vi.fn(),
  counts: {
    task: 0,
    taskAssignee: 0,
    taskEvent: 0,
    usage: 0,
    chatMessage: 0,
  },
  deleteManyCalls: [] as string[],
  revokeIntegrationsMock: vi.fn(),
}));

vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: failOpenMentionsMock,
  publishChatRoomMentionStatuses: publishMentionStatusesMock,
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
      chatRoomOrchestratorMember: {
        deleteMany: txOrchestratorMemberDeleteManyMock,
      },
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
      coworkerApiKey: { deleteMany: deleteManyRecorder("apiKeys") },
      task: {
        count: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if ("creatorOrchestratorId" in args.where) return counts.task;
          return counts.taskAssignee;
        }),
      },
      taskEvent: {
        count: vi.fn(async () => counts.taskEvent),
      },
      orchestratorUsage: { count: vi.fn(async () => counts.usage) },
      chatRoomMessage: { count: vi.fn(async () => counts.chatMessage) },
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
    // Deletion confirms the bot is live before it revokes anything remote.
    botFindFirstMock.mockResolvedValue({ id: BOT_ID });
    txBotFindFirstMock.mockResolvedValue({
      id: BOT_ID,
    });
    failOpenMentionsMock.mockResolvedValue([]);
    publishMentionStatusesMock.mockResolvedValue(undefined);
    txOrchestratorMemberDeleteManyMock.mockResolvedValue({ count: 0 });
  });

  it("removes the row outright when nothing references the bot", async () => {
    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("deleted");
    expect(txBotDeleteMock).toHaveBeenCalledWith({ where: { id: BOT_ID } });
    expect(txOrchestratorMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { orchestratorId: BOT_ID },
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

  it("tombstones the orchestrator when it authored chat", async () => {
    counts.chatMessage = 52;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.chatMessages).toBe(52);
    expect(txBotDeleteMock).not.toHaveBeenCalled();
    expect(txOrchestratorMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { orchestratorId: BOT_ID },
    });
    const data = txBotUpdateMock.mock.calls[0]?.[0]?.data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.name).toBeNull();
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
        "apiKeys",
      ]),
    );
  });

  it("fails pending orchestrator mentions before dropping memberships", async () => {
    failOpenMentionsMock.mockResolvedValue(["message_1"]);

    await deleteSokoBot(BOT_ID);

    expect(failOpenMentionsMock).toHaveBeenCalledWith(
      {
        where: { orchestratorId: BOT_ID },
        error: "Personal assistant is no longer a member of this room",
      },
      expect.any(Object),
    );
    expect(txOrchestratorMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { orchestratorId: BOT_ID },
    });
    expect(failOpenMentionsMock.mock.invocationCallOrder[0]).toBeLessThan(
      txOrchestratorMemberDeleteManyMock.mock.invocationCallOrder[0],
    );
    expect(publishMentionStatusesMock).toHaveBeenCalledWith(["message_1"]);
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

  it("revokes nothing when the bot is not there to delete", async () => {
    // Revoking first stranded a surviving bot with credentials already
    // withdrawn at the provider — worse than the orphan it was fixing.
    botFindFirstMock.mockResolvedValue(null);
    txBotFindFirstMock.mockResolvedValue(null);

    await expect(deleteSokoBot(BOT_ID)).rejects.toThrow();

    expect(revokeIntegrationsMock).not.toHaveBeenCalled();
  });

  it("refuses a bot that is already a tombstone", async () => {
    botFindFirstMock.mockResolvedValue(null);
    txBotFindFirstMock.mockResolvedValue(null);

    await expect(deleteSokoBot(BOT_ID)).rejects.toThrow();
  });
});
