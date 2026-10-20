import { beforeEach, describe, expect, it, vi } from "vitest";

const BOT_ID = "01960001-0001-7001-8001-000000000001";

const {
  botFindFirstMock,
  memberFindFirstMock,
  txBotFindFirstMock,
  txBotDeleteMock,
  txBotUpdateMock,
  txSokoBotMemberDeleteManyMock,
  txTurnUpdateManyMock,
  failOpenMentionsMock,
  publishMentionStatusesMock,
  counts,
  deleteManyCalls,
  revokeIntegrationsMock,
  txIntegrationsFindManyMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  txBotFindFirstMock: vi.fn(),
  txBotDeleteMock: vi.fn(),
  txBotUpdateMock: vi.fn(),
  txSokoBotMemberDeleteManyMock: vi.fn(),
  txTurnUpdateManyMock: vi.fn(),
  failOpenMentionsMock: vi.fn(),
  publishMentionStatusesMock: vi.fn(),
  counts: {
    task: 0,
    taskAssignee: 0,
    taskEvent: 0,
    usage: 0,
    chatMessage: 0,
    uploadedTaskFile: 0,
    taskSchedule: 0,
    job: 0,
  },
  deleteManyCalls: [] as string[],
  revokeIntegrationsMock: vi.fn(),
  txIntegrationsFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: failOpenMentionsMock,
  publishChatRoomMentionStatuses: publishMentionStatusesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: botFindFirstMock },
    member: { findFirst: memberFindFirstMock },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  revokeSokoBotIntegrationAccounts: revokeIntegrationsMock,
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
      chatRoomSokoBotMember: {
        deleteMany: txSokoBotMemberDeleteManyMock,
      },
      sokoBotTurn: {
        updateMany: txTurnUpdateManyMock,
        deleteMany: deleteManyRecorder("turns"),
      },
      sokoBotMemoryRevision: { deleteMany: deleteManyRecorder("memory") },
      sokoBotSchedule: { deleteMany: deleteManyRecorder("schedules") },
      sokoBotIntegration: {
        findMany: txIntegrationsFindManyMock,
        deleteMany: deleteManyRecorder("integrations"),
      },
      sokoBotInstalledSkill: { deleteMany: deleteManyRecorder("skills") },
      sokoBotLabRun: { deleteMany: deleteManyRecorder("labRuns") },
      sokoBotNudge: { deleteMany: deleteManyRecorder("nudges") },
      sokoBotTaskWatch: { deleteMany: deleteManyRecorder("watches") },
      sokoBotPendingDecision: { deleteMany: deleteManyRecorder("decisions") },
      sokoBotLegacyMessage: { deleteMany: deleteManyRecorder("legacy") },
      coworkerApiKey: { deleteMany: deleteManyRecorder("apiKeys") },
      task: {
        count: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if ("creatorSokoBotId" in args.where) return counts.task;
          return counts.taskAssignee;
        }),
      },
      taskEvent: {
        count: vi.fn(async () => counts.taskEvent),
      },
      sokoBotUsage: { count: vi.fn(async () => counts.usage) },
      chatRoomMessage: { count: vi.fn(async () => counts.chatMessage) },
      taskFile: { count: vi.fn(async () => counts.uploadedTaskFile) },
      taskSchedule: { count: vi.fn(async () => counts.taskSchedule) },
      job: { count: vi.fn(async () => counts.job) },
    }),
  ),
}));

import {
  deleteSokoBot,
  deleteSokoBotForUser,
} from "./soko-bot-deletion.service";

describe("deleteSokoBot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteManyCalls.length = 0;
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      counts[key] = 0;
    }
    revokeIntegrationsMock.mockResolvedValue({ revoked: 0, failed: [] });
    txIntegrationsFindManyMock.mockResolvedValue([]);
    // Deletion confirms the bot is live before it revokes anything remote.
    botFindFirstMock.mockResolvedValue({ id: BOT_ID });
    txBotFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      sharedRoomId: null,
    });
    failOpenMentionsMock.mockResolvedValue([]);
    publishMentionStatusesMock.mockResolvedValue(undefined);
    txSokoBotMemberDeleteManyMock.mockResolvedValue({ count: 0 });
  });

  it("removes the row outright when nothing references the bot", async () => {
    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("deleted");
    expect(txBotDeleteMock).toHaveBeenCalledWith({ where: { id: BOT_ID } });
    expect(txSokoBotMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { sokoBotId: BOT_ID },
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

  it("tombstones a shared bot with a room, so the room stays a read-only archive", async () => {
    txBotFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      sharedRoomId: "01960001-0001-7001-8001-0000000000aa",
    });

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(txBotDeleteMock).not.toHaveBeenCalled();
    const data = txBotUpdateMock.mock.calls[0]?.[0]?.data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("sharedRoomId");
  });

  it("tombstones a bot that created a Task Schedule, whose creator FK restricts deletion", async () => {
    counts.taskSchedule = 1;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.taskSchedules).toBe(1);
    expect(txBotDeleteMock).not.toHaveBeenCalled();
  });

  it("tombstones a bot that created a Job, whose creator FK restricts deletion", async () => {
    counts.job = 1;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.jobs).toBe(1);
    expect(txBotDeleteMock).not.toHaveBeenCalled();
  });

  it("tombstones for billing usage alone, so payment records survive", async () => {
    counts.usage = 261;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.billingRecords).toBe(261);
  });

  it("tombstones the soko bot when it authored chat", async () => {
    counts.chatMessage = 52;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.chatMessages).toBe(52);
    expect(txBotDeleteMock).not.toHaveBeenCalled();
    expect(txSokoBotMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { sokoBotId: BOT_ID },
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

  it("fails pending soko bot mentions before dropping memberships", async () => {
    failOpenMentionsMock.mockResolvedValue(["message_1"]);

    await deleteSokoBot(BOT_ID);

    expect(failOpenMentionsMock).toHaveBeenCalledWith(
      {
        where: { sokoBotId: BOT_ID },
        error: "Personal assistant is no longer a member of this room",
      },
      expect.any(Object),
    );
    expect(txSokoBotMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { sokoBotId: BOT_ID },
    });
    expect(failOpenMentionsMock.mock.invocationCallOrder[0]).toBeLessThan(
      txSokoBotMemberDeleteManyMock.mock.invocationCallOrder[0],
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

  it("revokes the integration snapshot only after bot deletion commits", async () => {
    const integrations = [
      {
        provider: "gmail",
        composioAccountId: "selected",
        pendingComposioAccountId: "latest",
      },
    ];
    txIntegrationsFindManyMock.mockResolvedValue(integrations);
    await deleteSokoBot(BOT_ID);
    expect(revokeIntegrationsMock).toHaveBeenCalledWith(BOT_ID, integrations);
    expect(txIntegrationsFindManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      txBotDeleteMock.mock.invocationCallOrder[0],
    );
    expect(txBotDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      revokeIntegrationsMock.mock.invocationCallOrder[0],
    );
  });

  it("does not revoke accounts when deletion rolls back", async () => {
    txBotDeleteMock.mockRejectedValueOnce(new Error("transaction failed"));
    await expect(deleteSokoBot(BOT_ID)).rejects.toThrow("transaction failed");
    expect(revokeIntegrationsMock).not.toHaveBeenCalled();
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

  it("keeps a tombstone when the assistant uploaded a task file", async () => {
    // The file outlives the bot on the Task and its uploader FK is
    // ON DELETE SET NULL, so a hard delete would leave the file with no
    // attribution and no way to recover it.
    counts.uploadedTaskFile = 1;

    const result = await deleteSokoBot(BOT_ID);

    expect(result.outcome).toBe("tombstoned");
    expect(result.retained.uploadedTaskFiles).toBe(1);
  });
});

describe("deleteSokoBotForUser", () => {
  const WORKSPACE_ID = "01960001-0001-7001-8001-0000000000aa";
  const ROLES: Record<string, string> = {
    owner_1: "owner",
    admin_1: "admin",
    member_1: "member",
  };
  const SHARED_ID = { kind: "id", sokoBotId: BOT_ID } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      counts[key] = 0;
    }
    revokeIntegrationsMock.mockResolvedValue({ revoked: 0, failed: [] });
    txIntegrationsFindManyMock.mockResolvedValue([]);
    txBotFindFirstMock.mockResolvedValue({ id: BOT_ID, sharedRoomId: null });
    failOpenMentionsMock.mockResolvedValue([]);
    publishMentionStatusesMock.mockResolvedValue(undefined);
    txSokoBotMemberDeleteManyMock.mockResolvedValue({ count: 0 });
    memberFindFirstMock.mockImplementation(
      async (args: { where: { userId: string } }) => {
        const role = ROLES[args.where.userId];
        return role ? { role } : null;
      },
    );
  });

  describe.each([
    ["project", "01960001-0001-7001-8001-0000000000bb"],
    ["workspace", null],
  ])("a shared %s bot", (_scope, projectId) => {
    beforeEach(() => {
      // An archived shared bot is still found by id: deleting is how it goes.
      botFindFirstMock.mockResolvedValue({
        id: BOT_ID,
        userId: null,
        projectId,
        workspaceId: WORKSPACE_ID,
        archivedAt: new Date(),
        workspace: { organizationId: "org_1" },
      });
    });

    it.each(["owner_1", "admin_1"])("lets %s delete it", async (userId) => {
      await expect(
        deleteSokoBotForUser(userId, WORKSPACE_ID, SHARED_ID),
      ).resolves.toMatchObject({ outcome: "deleted" });
      expect(txBotDeleteMock).toHaveBeenCalledWith({ where: { id: BOT_ID } });
    });

    it.each(["member_1", "outsider"])("refuses %s", async (userId) => {
      await expect(
        deleteSokoBotForUser(userId, WORKSPACE_ID, SHARED_ID),
      ).rejects.toMatchObject({ status: 403 });
      expect(revokeIntegrationsMock).not.toHaveBeenCalled();
      expect(txBotDeleteMock).not.toHaveBeenCalled();
    });
  });

  it("deletes the caller's own personal bot, archived or not, with no role read", async () => {
    botFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      userId: "member_1",
      workspaceId: WORKSPACE_ID,
    });
    await expect(
      deleteSokoBotForUser("member_1", WORKSPACE_ID),
    ).resolves.toMatchObject({ outcome: "deleted" });
    expect(botFindFirstMock).toHaveBeenCalledWith({
      where: { userId: "member_1", workspaceId: WORKSPACE_ID, deletedAt: null },
      select: { id: true, userId: true, workspaceId: true },
    });
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("answers a missing bot as not found", async () => {
    botFindFirstMock.mockResolvedValue(null);
    await expect(
      deleteSokoBotForUser("admin_1", WORKSPACE_ID, SHARED_ID),
    ).rejects.toMatchObject({ status: 404 });
  });
});
