import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { failOpenMentionsMock, writeOffProjectCreditsMock } = vi.hoisted(() => ({
  failOpenMentionsMock: vi.fn(),
  writeOffProjectCreditsMock: vi.fn(),
}));
vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: failOpenMentionsMock,
}));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    writeOffProjectCredits: writeOffProjectCreditsMock,
  },
}));

import { archiveProjectSokoBotsForClose } from "./project-soko-bots-close.service";

const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const BOT_A = "01960001-0001-7001-8001-00000000000a";
const BOT_B = "01960001-0001-7001-8001-00000000000b";

interface LockedBot {
  id: string;
  userId?: string | null;
  versionId?: string | null;
}

function transactionClient(locked: Array<string | LockedBot>) {
  const lockedBots = locked.map((bot) =>
    typeof bot === "string"
      ? { id: bot, userId: null, versionId: "soko-bot-v1" }
      : { userId: null, versionId: null, ...bot },
  );
  const lockedIds = lockedBots.map((bot) => bot.id);
  return {
    $queryRaw: vi.fn(async () => lockedBots),
    sokoBotTurn: { updateMany: vi.fn(async () => ({ count: 0 })) },
    sokoBot: { updateMany: vi.fn(async () => ({ count: lockedIds.length })) },
    chatRoomSokoBotMember: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
}

function queryText(tx: ReturnType<typeof transactionClient>): string {
  const [strings] = tx.$queryRaw.mock.calls[0] as unknown as [
    TemplateStringsArray,
  ];
  return strings.join("?");
}

describe("archiveProjectSokoBotsForClose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failOpenMentionsMock.mockResolvedValue(["mention-message-1"]);
  });

  it("locks only the Project's live bots", async () => {
    const tx = transactionClient([]);

    await expect(
      archiveProjectSokoBotsForClose(tx as never, PROJECT_ID),
    ).resolves.toEqual([]);

    const sql = queryText(tx);
    expect(sql).toContain('"projectId" = ?::uuid');
    expect(sql).toContain('"archivedAt" IS NULL');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.calls[0]).toContain(PROJECT_ID);
    expect(tx.sokoBot.updateMany).not.toHaveBeenCalled();
    expect(tx.sokoBotTurn.updateMany).not.toHaveBeenCalled();
    expect(failOpenMentionsMock).not.toHaveBeenCalled();
  });

  it("archives each bot like an archive does and returns the failed mentions", async () => {
    const tx = transactionClient([BOT_A, BOT_B]);

    const mentions = await archiveProjectSokoBotsForClose(
      tx as never,
      PROJECT_ID,
    );

    expect(mentions).toEqual(["mention-message-1"]);
    expect(tx.sokoBotTurn.updateMany).toHaveBeenCalledWith({
      where: {
        sokoBotId: { in: [BOT_A, BOT_B] },
        status: { in: ["STARTING", "RUNNING"] },
      },
      data: {
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: expect.any(Date),
      },
    });
    expect(tx.sokoBot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [BOT_A, BOT_B] } },
      data: {
        archivedAt: expect.any(Date),
        status: "PAUSED",
        eveSessionId: null,
      },
    });
    expect(failOpenMentionsMock).toHaveBeenCalledWith(
      {
        where: { sokoBotId: { in: [BOT_A, BOT_B] } },
        error: "This Soko Bot was archived when its project closed",
      },
      tx,
    );
    expect(tx.chatRoomSokoBotMember.deleteMany).toHaveBeenCalledWith({
      where: { sokoBotId: { in: [BOT_A, BOT_B] } },
    });
  });

  it("writes off the Project's credits when its Cuso is among the closed bots", async () => {
    const tx = transactionClient([
      BOT_A,
      { id: BOT_B, versionId: CMO_SOKO_BOT_VERSION_ID },
    ]);

    await archiveProjectSokoBotsForClose(tx as never, PROJECT_ID);

    expect(writeOffProjectCreditsMock).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
      tx,
    );
  });

  it("writes nothing off when the Project has no live Cuso", async () => {
    await archiveProjectSokoBotsForClose(
      transactionClient([BOT_A]) as never,
      PROJECT_ID,
    );
    await archiveProjectSokoBotsForClose(
      transactionClient([]) as never,
      PROJECT_ID,
    );

    expect(writeOffProjectCreditsMock).not.toHaveBeenCalled();
  });
});
