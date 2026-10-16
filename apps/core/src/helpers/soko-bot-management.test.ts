import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  assertSokoBotIntegrationReplace,
  assertSokoBotManagement,
  authorizeSokoBotTurnAction,
  findResolvableSokoBotDecision,
  isMemberAskedSokoBotTurn,
  memberAnswerableIntentWhere,
  type SokoBotAdminAction,
} from "./soko-bot-management";

const WORKSPACE_ID = "01960001-0001-7001-8001-0000000000aa";

const ROLES: Record<string, string> = {
  owner_1: "owner",
  admin_1: "admin",
  member_1: "member",
  member_2: "member",
};

/** Members of the bot's Organization; anyone else has no Member row. */
function fakeClient() {
  const memberFindFirst = vi.fn(
    async (args: {
      where: {
        userId: string;
        organization: { workspace: { id: string } };
      };
    }) => {
      const role =
        args.where.organization.workspace.id === WORKSPACE_ID
          ? ROLES[args.where.userId]
          : undefined;
      return role ? { role } : null;
    },
  );
  const decisionFindFirst = vi.fn();
  return {
    client: {
      member: { findFirst: memberFindFirst },
      sokoBotPendingDecision: { findFirst: decisionFindFirst },
    } as never,
    memberFindFirst,
    decisionFindFirst,
  };
}

const PROJECT_BOT = { userId: null, workspaceId: WORKSPACE_ID };
const WORKSPACE_BOT = { userId: null, workspaceId: WORKSPACE_ID };
const PERSONAL_BOT = { userId: "member_1", workspaceId: WORKSPACE_ID };
const ACTIONS: SokoBotAdminAction[] = ["archive", "delete", "resetMemory"];

describe("assertSokoBotManagement", () => {
  describe.each([
    ["project", PROJECT_BOT],
    ["workspace", WORKSPACE_BOT],
  ])("a shared %s bot", (_scope, bot) => {
    it.each(
      ACTIONS.flatMap((action) => [
        [action, "owner_1"],
        [action, "admin_1"],
      ]),
    )("lets an organization %s caller %s", async (action, userId) => {
      const { client } = fakeClient();
      await expect(
        assertSokoBotManagement(userId, bot, action, client),
      ).resolves.toBeUndefined();
    });

    it.each(
      ACTIONS.flatMap((action) => [
        [action, "member_1"],
        [action, "outsider"],
      ]),
    )("refuses %s to %s", async (action, userId) => {
      const { client } = fakeClient();
      await expect(
        assertSokoBotManagement(userId, bot, action, client),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("reads the role in the bot's own workspace", async () => {
      const { client, memberFindFirst } = fakeClient();
      await assertSokoBotManagement("admin_1", bot, "delete", client);
      expect(memberFindFirst).toHaveBeenCalledWith({
        where: {
          userId: "admin_1",
          organization: { workspace: { id: WORKSPACE_ID } },
        },
        select: { role: true },
      });
    });
  });

  it.each(ACTIONS)(
    "lets a personal bot's owner %s it without a role read",
    async (action) => {
      const { client, memberFindFirst } = fakeClient();
      await expect(
        assertSokoBotManagement("member_1", PERSONAL_BOT, action, client),
      ).resolves.toBeUndefined();
      expect(memberFindFirst).not.toHaveBeenCalled();
    },
  );

  it.each(ACTIONS)(
    "refuses %s of a personal bot to an admin who is not its owner",
    async (action) => {
      const { client, memberFindFirst } = fakeClient();
      await expect(
        assertSokoBotManagement("admin_1", PERSONAL_BOT, action, client),
      ).rejects.toMatchObject({ status: 403 });
      expect(memberFindFirst).not.toHaveBeenCalled();
    },
  );
});

describe("authorizeSokoBotTurnAction", () => {
  const chatTurn = {
    requestedByUserId: "member_1",
    source: "CHAT" as const,
    chainDepth: 0,
  };

  it.each([
    ["the asking member", "member_1", true],
    ["an admin", "admin_1", true],
    ["an owner", "owner_1", true],
    ["a non-member", "outsider", false],
  ])("on a shared chat turn, %s gets %s", async (_label, userId, expected) => {
    const { client } = fakeClient();
    await expect(
      authorizeSokoBotTurnAction(userId, chatTurn, PROJECT_BOT, client),
    ).resolves.toBe(expected);
  });

  it("refuses another member a shared chat turn", async () => {
    const { client } = fakeClient();
    await expect(
      authorizeSokoBotTurnAction("member_2", chatTurn, WORKSPACE_BOT, client),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(["SCHEDULE", "EVENT", "INGEST", "ADMIN_RETRY"] as const)(
    "keeps a self-started %s turn for an owner or admin",
    async (source) => {
      const { client } = fakeClient();
      const turn = { requestedByUserId: "member_1", source, chainDepth: 0 };
      await expect(
        authorizeSokoBotTurnAction("member_1", turn, PROJECT_BOT, client),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        authorizeSokoBotTurnAction("admin_1", turn, PROJECT_BOT, client),
      ).resolves.toBe(true);
      await expect(
        authorizeSokoBotTurnAction("owner_1", turn, PROJECT_BOT, client),
      ).resolves.toBe(true);
    },
  );

  it("keeps a chat turn another bot asked for with an owner or admin", async () => {
    const { client } = fakeClient();
    const turn = { ...chatTurn, chainDepth: 1 };
    await expect(
      authorizeSokoBotTurnAction("member_1", turn, PROJECT_BOT, client),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authorizeSokoBotTurnAction("admin_1", turn, PROJECT_BOT, client),
    ).resolves.toBe(true);
  });

  it.each([
    ["its member", "member_1", true],
    ["an admin", "admin_1", false],
    ["another member", "member_2", false],
  ])(
    "on a personal turn, %s gets %s without a role read",
    async (_label, userId, expected) => {
      const { client, memberFindFirst } = fakeClient();
      await expect(
        authorizeSokoBotTurnAction(
          userId,
          { requestedByUserId: "member_1", source: "SCHEDULE", chainDepth: 0 },
          PERSONAL_BOT,
          client,
        ),
      ).resolves.toBe(expected);
      expect(memberFindFirst).not.toHaveBeenCalled();
    },
  );
});

describe("findResolvableSokoBotDecision", () => {
  const decision = {
    id: "decision_1",
    requestedByUserId: "member_1",
    resolvedByUserId: null,
    turn: { source: "CHAT", chainDepth: 0 },
    sokoBot: WORKSPACE_BOT,
  };

  it("looks a decision up by id and status only, with its bot", async () => {
    const { client, decisionFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue(decision);
    await expect(
      findResolvableSokoBotDecision(
        "admin_1",
        "decision_1",
        true,
        true,
        client,
      ),
    ).resolves.toEqual({ ...decision, firstResolverUserId: "admin_1" });
    expect(decisionFindFirst).toHaveBeenCalledWith({
      where: { id: "decision_1", status: { in: ["PENDING", "PROCESSING"] } },
      include: {
        turn: true,
        sokoBot: { select: { userId: true, workspaceId: true } },
      },
    });
  });

  it("keeps the resolver a PROCESSING claim already recorded", async () => {
    const { client, decisionFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue({
      ...decision,
      resolvedByUserId: "member_1",
    });
    await expect(
      findResolvableSokoBotDecision(
        "admin_1",
        "decision_1",
        true,
        true,
        client,
      ),
    ).resolves.toMatchObject({ firstResolverUserId: "member_1" });
  });

  it("rejects only a PENDING decision", async () => {
    const { client, decisionFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue(null);
    await expect(
      findResolvableSokoBotDecision(
        "member_1",
        "decision_1",
        false,
        true,
        client,
      ),
    ).resolves.toBeNull();
    expect(decisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "decision_1", status: "PENDING" },
      }),
    );
  });

  it("hides a decision from a non-member and refuses another member", async () => {
    const { client, decisionFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue(decision);
    await expect(
      findResolvableSokoBotDecision(
        "outsider",
        "decision_1",
        true,
        true,
        client,
      ),
    ).resolves.toBeNull();
    await expect(
      findResolvableSokoBotDecision(
        "member_2",
        "decision_1",
        true,
        true,
        client,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the bot's own policy acceptance with the turn's member, even when self-started", async () => {
    const { client, decisionFindFirst, memberFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue({
      ...decision,
      turn: { source: "SCHEDULE", chainDepth: 0 },
    });
    await expect(
      findResolvableSokoBotDecision(
        "member_1",
        "decision_1",
        true,
        false,
        client,
      ),
    ).resolves.toMatchObject({ id: "decision_1" });
    await expect(
      findResolvableSokoBotDecision(
        "admin_1",
        "decision_1",
        true,
        false,
        client,
      ),
    ).resolves.toBeNull();
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("hides someone else's personal decision", async () => {
    const { client, decisionFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue({ ...decision, sokoBot: PERSONAL_BOT });
    await expect(
      findResolvableSokoBotDecision(
        "member_2",
        "decision_1",
        true,
        true,
        client,
      ),
    ).resolves.toBeNull();
  });

  it.each([
    ["an owner", "owner_1"],
    ["an admin", "admin_1"],
  ])(
    "lets %s answer a personal decision someone else asked for (ADR 0057)",
    async (_label, userId) => {
      const { client, decisionFindFirst } = fakeClient();
      decisionFindFirst.mockResolvedValue({
        ...decision,
        sokoBot: PERSONAL_BOT,
      });
      await expect(
        findResolvableSokoBotDecision(userId, "decision_1", true, true, client),
      ).resolves.toMatchObject({ id: "decision_1" });
    },
  );

  it.each([
    ["an admin", "admin_1", true],
    ["the bot's owner", "member_1", false],
  ])(
    "on a personal decision nobody asked for, %s may answer: %s",
    async (_label, userId, allowed) => {
      const { client, decisionFindFirst } = fakeClient();
      decisionFindFirst.mockResolvedValue({
        ...decision,
        requestedByUserId: null,
        sokoBot: PERSONAL_BOT,
      });
      const found = await findResolvableSokoBotDecision(
        userId,
        "decision_1",
        true,
        true,
        client,
      );
      expect(found !== null).toBe(allowed);
    },
  );

  it("keeps a decision nobody asked for with the runtime acting for nobody", async () => {
    const { client, decisionFindFirst } = fakeClient();
    decisionFindFirst.mockResolvedValue({
      ...decision,
      requestedByUserId: null,
    });
    await expect(
      findResolvableSokoBotDecision(null, "decision_1", true, false, client),
    ).resolves.toMatchObject({ id: "decision_1" });
    await expect(
      findResolvableSokoBotDecision(null, "decision_1", true, true, client),
    ).resolves.toBeNull();
  });
});

describe("isMemberAskedSokoBotTurn", () => {
  it.each([
    ["CHAT", 0, true],
    ["CHAT", 1, false],
    ["SCHEDULE", 0, false],
    ["EVENT", 0, false],
    ["INGEST", 0, false],
    ["ADMIN_RETRY", 0, false],
    [null, 0, false],
  ])("%s at depth %s -> %s", (source, chainDepth, expected) => {
    expect(isMemberAskedSokoBotTurn({ source, chainDepth })).toBe(expected);
  });
});

describe("assertSokoBotIntegrationReplace", () => {
  it.each([
    ["the connector", "member_2", "member_2"],
    ["an OWNER", "owner_1", "member_2"],
    ["an ADMIN", "admin_1", "member_2"],
  ])(
    "lets %s replace a shared bot's account",
    async (_who, caller, connector) => {
      const { client } = fakeClient();
      await expect(
        assertSokoBotIntegrationReplace(
          caller,
          WORKSPACE_BOT,
          connector,
          client,
        ),
      ).resolves.toBeUndefined();
    },
  );

  it("refuses another plain member", async () => {
    const { client } = fakeClient();
    await expect(
      assertSokoBotIntegrationReplace(
        "member_1",
        PROJECT_BOT,
        "member_2",
        client,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ["a non-member", "stranger"],
    ["a member when nobody is recorded as connector", "member_1"],
  ])("refuses %s", async (_who, caller) => {
    const { client } = fakeClient();
    await expect(
      assertSokoBotIntegrationReplace(caller, WORKSPACE_BOT, null, client),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("asks the connector without reading a role", async () => {
    const { client, memberFindFirst } = fakeClient();
    await assertSokoBotIntegrationReplace(
      "member_2",
      WORKSPACE_BOT,
      "member_2",
      client,
    );
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("leaves a personal bot to its owner check, with no role read", async () => {
    const { client, memberFindFirst } = fakeClient();
    await expect(
      assertSokoBotIntegrationReplace("member_1", PERSONAL_BOT, null, client),
    ).resolves.toBeUndefined();
    expect(memberFindFirst).not.toHaveBeenCalled();
  });
});

describe("memberAnswerableIntentWhere", () => {
  it("lets a personal bot's owner answer every offer", () => {
    expect(memberAnswerableIntentWhere({ userId: "owner" })).toEqual({});
  });

  it("hides a shared bot's self-started offers from member chat", () => {
    expect(memberAnswerableIntentWhere({ userId: null })).toEqual({
      originatingTurn: { source: "CHAT", chainDepth: 0 },
    });
  });
});
