import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  botFindManyMock,
  botFindUniqueMock,
  memberFindFirstMock,
  resolveMock,
  turnFindFirstMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  botFindManyMock: vi.fn(),
  botFindUniqueMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  resolveMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: {
      findFirst: botFindFirstMock,
      findMany: botFindManyMock,
      findUnique: botFindUniqueMock,
    },
    member: { findFirst: memberFindFirstMock },
    sokoBotTurn: { findFirst: turnFindFirstMock },
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
  getSokoBotAvatarFields,
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
    status: "IDLE",
    archivedAt: null,
    adminPausedAt: null,
    avatarImageUrl: null,
    avatar: null,
    turns: [],
    pendingDecisions: [],
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

  describe("avatar state", () => {
    const craftedAvatar = {
      styleId: "crafted-desk",
      styleVersion: 1,
      imageUrl: "https://blob.test/idle.webp",
      renders: [
        {
          state: "IDLE",
          stillUrl: "https://blob.test/idle.webp",
          loopUrl: "https://blob.test/idle-320.webp",
          loopLargeUrl: "https://blob.test/idle-560.webp",
        },
        {
          state: "WORKING",
          stillUrl: "https://blob.test/working.webp",
          loopUrl: null,
          loopLargeUrl: null,
        },
        { state: "DONE", stillUrl: null, loopUrl: null, loopLargeUrl: null },
      ],
    };

    async function stateOf(overrides: Record<string, unknown>) {
      botFindFirstMock.mockResolvedValue({ ...botRow(VIEWER), ...overrides });
      return await getSokoBotState(VIEWER, WORKSPACE_ID);
    }

    it("loads what the state needs: the avatar, the latest foreground turn", async () => {
      await stateOf({});

      const include = botFindFirstMock.mock.calls[0]?.[0].include;
      expect(include.turns).toMatchObject({
        where: { parentTurnId: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(include.avatar.select.renders).toBeDefined();
    });

    it.each([
      ["a running turn", { turns: [{ status: "RUNNING" }] }, "working"],
      ["a queued turn", { turns: [{ status: "QUEUED" }] }, "thinking"],
      [
        "an open decision during a run",
        {
          turns: [{ status: "RUNNING" }],
          pendingDecisions: [{ id: "d1" }],
        },
        "needs_you",
      ],
      [
        "a paused bot with an open decision",
        { status: "PAUSED", pendingDecisions: [{ id: "d1" }] },
        "offline",
      ],
      ["an archived bot", { archivedAt: new Date() }, "offline"],
      ["nothing going on", {}, "idle"],
    ])("derives %s as %s", async (_name, overrides, expected) => {
      const state = await stateOf(overrides);

      expect(state?.avatarState).toBe(expected);
    });

    it("shows done for a turn that completed a minute ago", async () => {
      const state = await stateOf({
        turns: [
          { status: "COMPLETED", completedAt: new Date(Date.now() - 60_000) },
        ],
      });

      expect(state?.avatarState).toBe("done");
    });

    it("describes a crafted avatar with only the renders that exist", async () => {
      const state = await stateOf({
        avatarImageUrl: "https://blob.test/idle.webp",
        avatar: craftedAvatar,
      });

      expect(state?.avatar).toMatchObject({
        styleId: "crafted-desk",
        stillUrl: "https://blob.test/idle.webp",
        states: {
          idle: { loopUrl: "https://blob.test/idle-320.webp" },
          working: {
            stillUrl: "https://blob.test/working.webp",
            loopUrl: null,
          },
          thinking: null,
          done: null,
          needs_you: null,
          offline: null,
        },
      });
      // The relation row itself does not leak into the response.
      expect(state?.avatar).not.toHaveProperty("renders");
      expect(state).not.toHaveProperty("turns");
    });

    it("falls back to the one image of a legacy mascot", async () => {
      const state = await stateOf({
        avatarImageUrl: "https://blob.test/mascot.png",
      });

      expect(state?.avatar).toMatchObject({
        styleId: "mascot",
        stillUrl: "https://blob.test/mascot.png",
        states: { idle: null, working: null },
      });
      expect(state?.avatarImageUrl).toBe("https://blob.test/mascot.png");
    });
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

  it("derives each shared bot's avatar state from its own latest turn", async () => {
    botFindManyMock.mockResolvedValue([
      {
        ...botRow(null),
        projectId: "project_1",
        turns: [{ status: "RUNNING", completedAt: null }],
      },
      { ...botRow(null), id: "bot_2", projectId: null, status: "PAUSED" },
    ]);
    memberFindFirstMock.mockResolvedValue({ role: "member" });

    const bots = await listSharedSokoBots(VIEWER, WORKSPACE_ID);

    expect(bots.map((bot) => bot.avatarState)).toEqual(["working", "offline"]);
    expect(bots[0]).not.toHaveProperty("turns");
    expect(bots[0]).not.toHaveProperty("adminPausedAt");
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

describe("getSokoBotAvatarFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the state for the admin detail, offline when Soko Bots are off", async () => {
    botFindUniqueMock.mockResolvedValue({
      ...botRow(null),
      turns: [{ status: "RUNNING", completedAt: null }],
    });

    expect(await getSokoBotAvatarFields(BOT_ID)).toMatchObject({
      avatarState: "working",
    });
    expect(await getSokoBotAvatarFields(BOT_ID, true)).toMatchObject({
      avatarState: "offline",
    });
  });

  it("adds nothing for a bot that is gone", async () => {
    botFindUniqueMock.mockResolvedValue(null);

    expect(await getSokoBotAvatarFields(BOT_ID)).toEqual({});
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
      pendingDecisions: [],
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

  describe("the avatar state, for a surface that only watches this", () => {
    const BOT = {
      id: "bot-1",
      status: "ACTIVE",
      lastTurnAt: null,
      archivedAt: null,
      adminPausedAt: null,
      turns: [],
      pendingDecisions: [],
    };

    it("is working while a turn runs, without a second read", async () => {
      botFindFirstMock.mockResolvedValue({
        ...BOT,
        turns: [{ id: "turn-1", status: "RUNNING", completedAt: null }],
      });

      const activity = await getSokoBotActivity(VIEWER, WORKSPACE_ID);

      expect(activity).toMatchObject({
        activeTurnId: "turn-1",
        avatarState: "working",
      });
      expect(turnFindFirstMock).not.toHaveBeenCalled();
    });

    it("is done shortly after the latest turn completed", async () => {
      botFindFirstMock.mockResolvedValue(BOT);
      turnFindFirstMock.mockResolvedValue({
        status: "COMPLETED",
        completedAt: new Date(),
      });

      const activity = await getSokoBotActivity(VIEWER, WORKSPACE_ID);

      expect(turnFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sokoBotId: "bot-1", parentTurnId: null },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(activity?.avatarState).toBe("done");
    });

    it("is idle with no turn at all", async () => {
      botFindFirstMock.mockResolvedValue(BOT);
      turnFindFirstMock.mockResolvedValue(null);

      const activity = await getSokoBotActivity(VIEWER, WORKSPACE_ID);

      expect(activity?.avatarState).toBe("idle");
    });

    it("needs you while a decision is open, even with a turn running", async () => {
      botFindFirstMock.mockResolvedValue({
        ...BOT,
        turns: [{ id: "turn-1", status: "RUNNING", completedAt: null }],
        pendingDecisions: [{ id: "decision-1" }],
      });

      const activity = await getSokoBotActivity(VIEWER, WORKSPACE_ID);

      expect(activity?.avatarState).toBe("needs_you");
    });

    it("is offline when the bot is paused", async () => {
      botFindFirstMock.mockResolvedValue({ ...BOT, status: "PAUSED" });
      turnFindFirstMock.mockResolvedValue(null);

      const activity = await getSokoBotActivity(VIEWER, WORKSPACE_ID);

      expect(activity?.avatarState).toBe("offline");
    });
  });
});
