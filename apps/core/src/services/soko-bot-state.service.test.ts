import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  botFindManyMock,
  memberFindFirstMock,
  resolveMock,
  turnFindFirstMock,
  messageFindFirstMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  botFindManyMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  resolveMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: botFindFirstMock, findMany: botFindManyMock },
    member: { findFirst: memberFindFirstMock },
    sokoBotTurn: { findFirst: turnFindFirstMock },
    chatRoomMessage: { findFirst: messageFindFirstMock },
  },
}));

vi.mock("@/helpers/soko-bot-resolver", () => ({
  ME_SOKO_BOT: { kind: "me" },
  memberSokoBot: resolveMock,
}));

import {
  ACTIVE_TURN_STATUSES,
  FOREGROUND_TURN,
} from "@/services/soko-bot-control-plane.service";
import {
  getSokoBotActivity,
  getSokoBotLastFailure,
  getSokoBotState,
  listSharedSokoBots,
} from "./soko-bot-state.service";

const VIEWER = "viewer_1";
const WORKSPACE_ID = "workspace_1";
const BOT_ID = "bot_1";

function botRow(userId: string | null) {
  return {
    id: BOT_ID,
    userId,
    workspaceId: WORKSPACE_ID,
    memoryHash: "stale",
    memoryRevisions: [],
  };
}

describe("getSokoBotState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the viewer's live personal bot for me, without an access read", async () => {
    botFindFirstMock.mockResolvedValue(botRow(VIEWER));

    const state = await getSokoBotState(VIEWER, WORKSPACE_ID);

    expect(resolveMock).not.toHaveBeenCalled();
    expect(botFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: VIEWER, workspaceId: WORKSPACE_ID, archivedAt: null },
      }),
    );
    expect(state?.viewerCanManage).toBe(true);
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("reads by id only after the access check, archived bots included", async () => {
    resolveMock.mockResolvedValue({ id: BOT_ID });
    botFindFirstMock.mockResolvedValue(botRow(null));
    memberFindFirstMock.mockResolvedValue({ role: "member" });

    const state = await getSokoBotState(VIEWER, WORKSPACE_ID, {
      kind: "id",
      sokoBotId: BOT_ID,
    });

    expect(botFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOT_ID } }),
    );
    expect(state?.viewerCanManage).toBe(false);
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ])("lets a shared bot's %s manage it: %s", async (role, canManage) => {
    resolveMock.mockResolvedValue({ id: BOT_ID });
    botFindFirstMock.mockResolvedValue(botRow(null));
    memberFindFirstMock.mockResolvedValue({ role });

    const state = await getSokoBotState(VIEWER, WORKSPACE_ID, {
      kind: "id",
      sokoBotId: BOT_ID,
    });

    expect(state?.viewerCanManage).toBe(canManage);
  });

  it("returns null without reading when the bot is out of reach", async () => {
    resolveMock.mockResolvedValue(null);

    const state = await getSokoBotState(VIEWER, WORKSPACE_ID, {
      kind: "id",
      sokoBotId: BOT_ID,
    });

    expect(state).toBeNull();
    expect(botFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("listSharedSokoBots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks Cuso: a Project bot on CMO's version", async () => {
    const shared = {
      userId: null,
      workspaceId: WORKSPACE_ID,
      name: null,
      avatarSeed: null,
      avatarImageUrl: null,
      status: "IDLE",
      archivedAt: null,
      sharedRoomId: null,
    };
    botFindManyMock.mockResolvedValue([
      {
        ...shared,
        id: "cuso",
        projectId: "p1",
        versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      },
      { ...shared, id: "helper", projectId: "p1", versionId: "v1" },
      {
        ...shared,
        id: "team",
        projectId: null,
        versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      },
    ]);

    const bots = await listSharedSokoBots(VIEWER, WORKSPACE_ID);

    expect(bots.map(({ id, cuso }) => [id, cuso])).toEqual([
      ["cuso", true],
      ["helper", false],
      ["team", false],
    ]);
  });

  it("lists only owner-less, undeleted bots of an organization workspace the viewer reaches", async () => {
    botFindManyMock.mockResolvedValue([]);

    expect(await listSharedSokoBots(VIEWER, WORKSPACE_ID)).toEqual([]);
    expect(botFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          userId: null,
          deletedAt: null,
          workspace: expect.objectContaining({
            id: WORKSPACE_ID,
            organizationId: { not: null },
          }),
        }),
      }),
    );
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("maps the scope and reads the viewer's role once", async () => {
    botFindManyMock.mockResolvedValue([
      { ...botRow(null), projectId: "project_1" },
      { ...botRow(null), id: "bot_2", projectId: null },
    ]);
    memberFindFirstMock.mockResolvedValue({ role: "admin" });

    const bots = await listSharedSokoBots(VIEWER, WORKSPACE_ID);

    expect(
      bots.map(({ id, scope, viewerCanManage }) => [
        id,
        scope,
        viewerCanManage,
      ]),
    ).toEqual([
      [BOT_ID, "project", true],
      ["bot_2", "workspace", true],
    ]);
    expect(bots[0]).not.toHaveProperty("userId");
    expect(memberFindFirstMock).toHaveBeenCalledTimes(1);
  });
});

describe("getSokoBotActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only chat turns, not background runs, as activity", async () => {
    botFindFirstMock.mockResolvedValue({
      status: "RUNNING",
      lastTurnAt: null,
      turns: [],
    });

    await getSokoBotActivity(VIEWER, WORKSPACE_ID);

    expect(FOREGROUND_TURN).toEqual({ parentTurnId: null });
    expect(botFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: VIEWER, workspaceId: WORKSPACE_ID, archivedAt: null },
        select: expect.objectContaining({
          turns: expect.objectContaining({
            where: {
              parentTurnId: null,
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
          }),
        }),
      }),
    );
  });

  it("says when the bot was last active, and nothing about its face", async () => {
    const lastActivityAt = new Date("2026-11-01T10:00:00Z");
    botFindFirstMock.mockResolvedValue({
      status: "IDLE",
      lastTurnAt: null,
      lastActivityAt,
      turns: [],
    });

    expect(await getSokoBotActivity(VIEWER, WORKSPACE_ID)).toEqual({
      status: "IDLE",
      activeTurnId: null,
      lastTurnAt: null,
      lastActivityAt,
    });
  });
});

describe("getSokoBotLastFailure", () => {
  beforeEach(() => {
    turnFindFirstMock.mockReset();
    messageFindFirstMock.mockReset();
  });

  it("points at the failed reply in a room the reader belongs to", async () => {
    turnFindFirstMock.mockResolvedValue({
      source: "CHAT",
      destinationRoomId: "room_channel",
      chatResponseMessageId: "reply_1",
    });
    messageFindFirstMock.mockResolvedValue({
      id: "reply_1",
      roomId: "room_channel",
    });

    await expect(getSokoBotLastFailure(BOT_ID, VIEWER)).resolves.toEqual({
      roomId: "room_channel",
      messageId: "reply_1",
    });
    expect(turnFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sokoBotId: BOT_ID, parentTurnId: null, status: "FAILED" },
      }),
    );
    expect(messageFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "reply_1",
          roomId: "room_channel",
          deletedAt: null,
          room: {
            archivedAt: null,
            userMembers: { some: { userId: VIEWER } },
          },
        }),
      }),
    );
  });

  it("gives no room when the reader cannot open it", async () => {
    turnFindFirstMock.mockResolvedValue({
      source: "CHAT",
      destinationRoomId: "room_private",
      chatResponseMessageId: "reply_1",
    });
    messageFindFirstMock.mockResolvedValue(null);

    await expect(getSokoBotLastFailure(BOT_ID, VIEWER)).resolves.toEqual({
      roomId: null,
      messageId: null,
    });
  });

  it("gives no room for work that was not a chat reply", async () => {
    turnFindFirstMock.mockResolvedValue({
      source: "SCHEDULE",
      destinationRoomId: "room_direct",
      chatResponseMessageId: null,
    });

    await expect(getSokoBotLastFailure(BOT_ID, VIEWER)).resolves.toEqual({
      roomId: null,
      messageId: null,
    });
    expect(messageFindFirstMock).not.toHaveBeenCalled();
  });
});
