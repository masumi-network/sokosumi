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
    userId: "job_owner",
    organizationId: "org_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2022-01-01"),
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
  const findUnique = vi.fn(async (args: { where: { id: string } }) =>
    args.where.id === "bot_1" ? bot : null,
  );
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
  jobOwnerId: "job_owner",
  taskOwnerId: "task_owner",
  systemRhythm: true,
};

const STRANGERS = [
  ["a user who left", "gone"],
  ["a member of another Organization", "other_org_member"],
  ["a banned member", "banned_member"],
] as const;

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
        { ...allHints, replayUserId: "gone" },
        client,
      ),
    ).resolves.toBe("owner_1");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("replays for the original member and ignores every other step", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(
        sharedBot,
        { ...allHints, replayUserId: "turn_member" },
        client,
      ),
    ).resolves.toBe("turn_member");
  });

  it.each(STRANGERS)(
    "refuses a replay for %s instead of running it as someone else",
    async (_label, stranger) => {
      const { client, findMany } = fakeClient();
      await expect(
        resolveTurnUserId(
          sharedBot,
          { ...allHints, replayUserId: stranger },
          client,
        ),
      ).resolves.toBeNull();
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        organizationId: "org_1",
        userId: { in: [stranger] },
      });
    },
  );

  it("takes the schedule's member first", async () => {
    const { client } = fakeClient();
    await expect(resolveTurnUserId(sharedBot, allHints, client)).resolves.toBe(
      "schedule_member",
    );
  });

  it.each(STRANGERS)(
    "skips %s at every hint step",
    async (_label, stranger) => {
      const { client } = fakeClient();
      const steps = [
        "scheduleUserId",
        "taskEventUserId",
        "jobOwnerId",
        "taskOwnerId",
      ] as const;
      const expected = ["event_member", "job_owner", "task_owner", "creator"];
      for (const [index, step] of steps.entries()) {
        const hints = { ...allHints };
        for (const skipped of steps.slice(0, index + 1))
          hints[skipped] = stranger;
        await expect(
          resolveTurnUserId(sharedBot, hints, client),
          `${step} skipped`,
        ).resolves.toBe(expected[index]);
      }
      await expect(
        resolveTurnUserId(
          { ...sharedBot, createdByUserId: stranger },
          {
            scheduleUserId: stranger,
            taskEventUserId: stranger,
            jobOwnerId: stranger,
            taskOwnerId: stranger,
            systemRhythm: true,
          },
          client,
        ),
      ).resolves.toBe("owner_old");
    },
  );

  it("takes the TaskEvent's member when the schedule is missing", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(
        sharedBot,
        { taskEventUserId: "event_member", jobOwnerId: "job_owner" },
        client,
      ),
    ).resolves.toBe("event_member");
  });

  it("takes the Job's hiring member before the Task owner", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(
        sharedBot,
        { jobOwnerId: "job_owner", taskOwnerId: "task_owner" },
        client,
      ),
    ).resolves.toBe("job_owner");
  });

  it("takes the Task owner after the Job owner", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(sharedBot, { taskOwnerId: "task_owner" }, client),
    ).resolves.toBe("task_owner");
  });

  it("takes the creator only for a built-in rhythm", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(sharedBot, { systemRhythm: true }, client),
    ).resolves.toBe("creator");
  });

  it("skips the creator for a member schedule, an event or a retry", async () => {
    const { client } = fakeClient();
    await expect(
      resolveTurnUserId(sharedBot, { scheduleUserId: "gone" }, client),
    ).resolves.toBe("owner_old");
    await expect(resolveTurnUserId(sharedBot, {}, client)).resolves.toBe(
      "owner_old",
    );
  });

  it("falls back to the earliest live OWNER, never an earlier ADMIN", async () => {
    const { client, findMany } = fakeClient();
    await expect(resolveTurnUserId(sharedBot, {}, client)).resolves.toBe(
      "owner_old",
    );
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
    await expect(resolveTurnUserId(sharedBot, {}, client)).resolves.toBe(
      "owner_new",
    );
  });

  it("returns null when no live member is left", async () => {
    const { client } = fakeClient(
      MEMBERS.filter((row) => row.role !== MemberRole.OWNER),
    );
    await expect(
      resolveTurnUserId(
        { ...sharedBot, createdByUserId: "gone" },
        { systemRhythm: true },
        client,
      ),
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
    const { client, findUnique } = fakeClient(MEMBERS, {
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
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot_1" } }),
    );
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
    const { client } = fakeClient(MEMBERS, sharedBot);
    await expect(sokoBotTurnStarter("bot_2", {}, client)).resolves.toBeNull();
  });

  it("returns null for a shared bot with no live member", async () => {
    const { client } = fakeClient([], sharedBot);
    await expect(sokoBotTurnStarter("bot_1", {}, client)).resolves.toBeNull();
  });
});
