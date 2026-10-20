import { beforeEach, describe, expect, it, vi } from "vitest";

const { failOpenMentionsMock } = vi.hoisted(() => ({
  failOpenMentionsMock: vi.fn(),
}));
vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: failOpenMentionsMock,
}));

import { archiveProjectSokoBotsForClose } from "./project-soko-bots-close.service";

const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const BOT_A = "01960001-0001-7001-8001-00000000000a";
const BOT_B = "01960001-0001-7001-8001-00000000000b";

function transactionClient(lockedIds: string[]) {
  return {
    $queryRaw: vi.fn(async () => lockedIds.map((id) => ({ id }))),
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
});
