import { MemberRole } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  resolveTurnUserId,
  sokoBotTurnStarter,
  type TurnAttributionBot,
} from "./soko-bot-turn-attribution";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

interface MemberRow {
  userId: string;
  organizationId: string;
  role: string;
  createdAt: Date;
  banned?: boolean;
}

const MEMBERS: MemberRow[] = [
  {
    userId: "admin_first",
    organizationId: "org_1",
    role: MemberRole.ADMIN,
    createdAt: new Date("2019-01-01"),
  },
  {
    userId: "owner_old",
    organizationId: "org_1",
    role: MemberRole.OWNER,
    createdAt: new Date("2020-01-01"),
  },
  {
    userId: "owner_new",
    organizationId: "org_1",
    role: MemberRole.OWNER,
    createdAt: new Date("2021-01-01"),
  },
  {
    userId: "turn_member",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
  },
  {
    userId: "schedule_member",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
  },
  {
    userId: "event_member",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
  },
  {
    userId: "task_owner",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
  },
  {
    userId: "creator",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
  },
  {
    userId: "banned_member",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
    banned: true,
  },
  {
    userId: "other_org_member",
    organizationId: "org_2",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
  },
];

interface MemberFindManyArgs {
  where: {
    organizationId: string;
    userId?: { in: string[] };
    role?: string;
  };
  orderBy?: unknown;
}

function fakeClient(members: MemberRow[] = MEMBERS, bot: unknown = null) {
  const findMany = vi.fn(async (args: MemberFindManyArgs) => {
    const rows = members.filter(
      (row) =>
        row.organizationId === args.where.organizationId &&
        (!args.where.userId || args.where.userId.in.includes(row.userId)) &&
        (!args.where.role || row.role === args.where.role),
    );
    if (args.orderBy) {
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    return rows.map((row) => ({
      userId: row.userId,
      user: { banned: row.banned ?? false, banExpires: null },
    }));
  });
  const findUnique = vi.fn(async () => bot);
  return {
    client: { member: { findMany }, sokoBot: { findUnique } } as never,
    findMany,
    findUnique,
  };
}

const sharedBot: TurnAttributionBot = {
  userId: null,
  createdByUserId: "creator",
  workspace: { organizationId: "org_1" },
};

const allHints = {
  scheduleUserId: "schedule_member",
  taskEventUserId: "event_member",
  taskOwnerId: "task_owner",
};

describe("resolveTurnUserId", () => {
  it("keeps a personal bot's owner and reads nothing", async () => {
    const { client, findMany } = fakeClient();
    await expect(
      resolveTurnUserId(
        {
          userId: "owner_1",
          createdByUserId: "creator",
          workspace: { organizationId: "org_1" },
        },
        { ...allHints, turnUserId: "turn_member" },
        client,
      ),
    ).resolves.toBe("owner_1");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("takes a replayed turn's member before every other step", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(
        sharedBot,
        { ...allHints, turnUserId: "turn_member" },
        client,
      ),
    ).resolves.toBe("turn_member");
  });

  it("takes the schedule's member first", async () => {
    const { client } = fakeClient();
    await expect(resolveTurnUserId(sharedBot, allHints, client)).resolves.toBe(
      "schedule_member",
    );
  });

  it.each([
    ["a user who left", "gone"],
    ["a member of another Organization", "other_org_member"],
    ["a banned member", "banned_member"],
  ])("skips %s at every hint step", async (_label, stranger) => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(
        sharedBot,
        {
          turnUserId: stranger,
          scheduleUserId: stranger,
          taskEventUserId: "event_member",
        },
        client,
      ),
    ).resolves.toBe("event_member");
    await expect(
      resolveTurnUserId(
        sharedBot,
        {
          scheduleUserId: stranger,
          taskEventUserId: stranger,
          taskOwnerId: "task_owner",
        },
        client,
      ),
    ).resolves.toBe("task_owner");
    await expect(
      resolveTurnUserId(
        sharedBot,
        {
          scheduleUserId: stranger,
          taskEventUserId: stranger,
          taskOwnerId: stranger,
        },
        client,
      ),
    ).resolves.toBe("creator");
    await expect(
      resolveTurnUserId(
        { ...sharedBot, createdByUserId: stranger },
        {
          scheduleUserId: stranger,
          taskEventUserId: stranger,
          taskOwnerId: stranger,
        },
        client,
      ),
    ).resolves.toBe("owner_old");
  });

  it("takes the TaskEvent's member when the schedule is missing", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(
        sharedBot,
        { taskEventUserId: "event_member", taskOwnerId: "task_owner" },
        client,
      ),
    ).resolves.toBe("event_member");
  });

  it("takes the Task owner after the TaskEvent", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(sharedBot, { taskOwnerId: "task_owner" }, client),
    ).resolves.toBe("task_owner");
  });

  it("takes the creator when no hint applies", async () => {
    const { client } = fakeClient();
    await expect(resolveTurnUserId(sharedBot, {}, client)).resolves.toBe(
      "creator",
    );
  });

  it("falls back to the earliest live OWNER, never an earlier ADMIN", async () => {
    const { client, findMany } = fakeClient();
    await expect(
      resolveTurnUserId({ ...sharedBot, createdByUserId: null }, {}, client),
    ).resolves.toBe("owner_old");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", role: MemberRole.OWNER },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("skips a banned earliest OWNER", async () => {
    const members = MEMBERS.map((row) =>
      row.userId === "owner_old" ? { ...row, banned: true } : row,
    );
    const { client } = fakeClient(members);
    await expect(
      resolveTurnUserId({ ...sharedBot, createdByUserId: "gone" }, {}, client),
    ).resolves.toBe("owner_new");
  });

  it("returns null when no live member is left", async () => {
    const { client } = fakeClient(
      MEMBERS.filter((row) => row.role !== MemberRole.OWNER),
    );
    await expect(
      resolveTurnUserId({ ...sharedBot, createdByUserId: "gone" }, {}, client),
    ).resolves.toBeNull();
  });

  it("returns null for a shared bot outside an Organization", async () => {
    const { client, findMany } = fakeClient();
    await expect(
      resolveTurnUserId(
        { ...sharedBot, workspace: { organizationId: null } },
        allHints,
        client,
      ),
    ).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("sokoBotTurnStarter", () => {
  it("names only the owner for a personal bot, so startTurn keeps its me lookup", async () => {
    const { client } = fakeClient(MEMBERS, {
      userId: "owner_1",
      createdByUserId: "owner_1",
      workspace: { organizationId: null },
    });
    await expect(
      sokoBotTurnStarter(
        "bot_1",
        { scheduleUserId: "schedule_member" },
        client,
      ),
    ).resolves.toEqual({ userId: "owner_1" });
  });

  it("names the member and the bot for a shared bot", async () => {
    const { client } = fakeClient(MEMBERS, sharedBot);
    await expect(
      sokoBotTurnStarter(
        "bot_1",
        { scheduleUserId: "schedule_member" },
        client,
      ),
    ).resolves.toEqual({ userId: "schedule_member", sokoBotId: "bot_1" });
  });

  it("returns null for a missing bot", async () => {
    const { client } = fakeClient(MEMBERS, null);
    await expect(sokoBotTurnStarter("bot_1", {}, client)).resolves.toBeNull();
  });

  it("returns null for a shared bot with no live member", async () => {
    const { client } = fakeClient([], sharedBot);
    await expect(sokoBotTurnStarter("bot_1", {}, client)).resolves.toBeNull();
  });
});
