import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  resolveScheduleTiming,
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
  updateSokoBotSchedule,
} from "./soko-bot-schedule.service";

const now = new Date("2026-09-30T12:00:00.000Z");

describe("resolveScheduleTiming", () => {
  it("runs a one-time schedule exactly at runAt, mirroring it as wall-clock cron", () => {
    const timing = resolveScheduleTiming(
      { runAt: "2026-10-01T09:00:00+02:00", timezone: "Europe/Berlin" },
      now,
    );
    expect(timing).toEqual({
      cronExpression: "0 9 1 10 *",
      nextRunAt: new Date("2026-10-01T07:00:00.000Z"),
      runOnce: true,
    });
  });

  it("rejects a one-time schedule in the past or beyond a year", () => {
    expect(() =>
      resolveScheduleTiming(
        { runAt: "2026-09-30T11:00:00Z", timezone: "UTC" },
        now,
      ),
    ).toThrow(SokoBotScheduleValidationError);
    expect(() =>
      resolveScheduleTiming(
        { runAt: "2028-01-01T09:00:00Z", timezone: "UTC" },
        now,
      ),
    ).toThrow(SokoBotScheduleValidationError);
  });

  it("finds the first Monday of each month with the # weekday form", () => {
    const first = resolveScheduleTiming(
      { cronExpression: "0 10 * * 1#1", timezone: "Europe/Berlin" },
      now,
    );
    expect(first.runOnce).toBe(false);
    // 5 Oct 2026 is the first Monday of October; 10:00 Berlin is 08:00 UTC.
    expect(first.nextRunAt).toEqual(new Date("2026-10-05T08:00:00.000Z"));
    const second = resolveScheduleTiming(
      { cronExpression: "0 10 * * 1#1", timezone: "Europe/Berlin" },
      new Date(first.nextRunAt.getTime() + 60_000),
    );
    // 2 Nov 2026, after the switch to winter time.
    expect(second.nextRunAt).toEqual(new Date("2026-11-02T09:00:00.000Z"));
  });

  it("rejects day-of-month combined with a weekday, which cron reads as either", () => {
    expect(() =>
      resolveScheduleTiming(
        { cronExpression: "0 10 1-7 * 1", timezone: "UTC" },
        now,
      ),
    ).toThrow(/either one/);
  });

  it("needs a cron or a runAt", () => {
    expect(() => resolveScheduleTiming({ timezone: "UTC" }, now)).toThrow(
      SokoBotScheduleValidationError,
    );
  });
});

describe("schedules of a shared bot", () => {
  const SHARED_BOT_ID = "01960001-0001-7001-8001-000000000001";
  const PERSONAL_BOT_ID = "01960001-0001-7001-8001-000000000002";
  const WORKSPACE_ID = "01960001-0001-7001-8001-0000000000aa";
  const BOT_OWNERS: Record<string, string | null> = {
    [SHARED_BOT_ID]: null,
    [PERSONAL_BOT_ID]: "owner_1",
  };
  const schedule = (
    id: string,
    sokoBotId: string,
    requestedByUserId: string,
  ) => ({
    id,
    sokoBotId,
    requestedByUserId,
    workspaceId: WORKSPACE_ID,
    name: `Stand-up ${id}`,
    timezone: "UTC",
    cronExpression: "0 9 * * 1",
    prompt: "How is it going?",
    enabled: true,
    nextRunAt: new Date("2099-01-01T09:00:00.000Z"),
    systemKey: null,
  });
  const SHARED = schedule(
    "01960001-0001-7001-8001-0000000000cc",
    SHARED_BOT_ID,
    "author_1",
  );
  const PERSONAL = schedule(
    "01960001-0001-7001-8001-0000000000dd",
    PERSONAL_BOT_ID,
    "owner_1",
  );
  let members: Set<string>;

  interface ScheduleWhere {
    requestedByUserId?: string;
    workspaceId?: string;
    sokoBotId?: string;
    sokoBot?: { userId: string };
    OR?: { id?: string }[];
  }
  const matches = (row: typeof SHARED, where: ScheduleWhere) =>
    (where.requestedByUserId === undefined ||
      row.requestedByUserId === where.requestedByUserId) &&
    (where.workspaceId === undefined ||
      row.workspaceId === where.workspaceId) &&
    (where.sokoBotId === undefined || row.sokoBotId === where.sokoBotId) &&
    (where.sokoBot === undefined ||
      BOT_OWNERS[row.sokoBotId] === where.sokoBot.userId) &&
    (where.OR === undefined || where.OR.some((arm) => arm.id === row.id));
  const scheduleFindFirst = vi.fn(
    async (args: { where: ScheduleWhere }) =>
      [SHARED, PERSONAL].find((row) => matches(row, args.where)) ?? null,
  );
  const scheduleFindMany = vi.fn(async (args: { where: ScheduleWhere }) =>
    [SHARED, PERSONAL].filter((row) => matches(row, args.where)),
  );
  /** The resolver's id rule: the bot, in its workspace, for a live member. */
  const botFindFirst = vi.fn(
    async (args: {
      where: {
        id: string;
        workspaceId: string;
        workspace: {
          id: string;
          OR: [
            { userId: string },
            { organization: { members: { some: { userId: string } } } },
          ];
        };
      };
    }) => {
      const { id, workspaceId, workspace } = args.where;
      const caller = workspace.OR[1].organization.members.some.userId;
      if (
        !(id in BOT_OWNERS) ||
        workspaceId !== WORKSPACE_ID ||
        workspace.id !== WORKSPACE_ID ||
        workspace.OR[0].userId !== caller ||
        !members.has(caller)
      ) {
        return null;
      }
      return {
        id,
        userId: BOT_OWNERS[id],
        workspaceId: WORKSPACE_ID,
        workspace: { organizationId: "org_1" },
      };
    },
  );
  const scheduleUpdate = vi.fn();
  const scheduleDelete = vi.fn();
  const scheduleCreate = vi.fn();
  const tx = {
    sokoBot: { findFirst: botFindFirst },
    workspace: { findFirst: vi.fn().mockResolvedValue({ id: WORKSPACE_ID }) },
    sokoBotSchedule: {
      findFirst: scheduleFindFirst,
      findMany: scheduleFindMany,
      update: scheduleUpdate,
      delete: scheduleDelete,
      create: scheduleCreate,
      count: vi.fn().mockResolvedValue(0),
    },
  } as never;
  /** The runtime names the turn's bot; the `me` routes name only the schedule. */
  const turnRef = (row: typeof SHARED) => ({
    scheduleId: row.id,
    workspaceId: WORKSPACE_ID,
    sokoBotId: row.sokoBotId,
  });
  const meRef = (row: typeof SHARED) => ({ scheduleId: row.id });

  beforeEach(() => {
    vi.clearAllMocks();
    members = new Set(["author_1", "member_2", "owner_1"]);
    scheduleUpdate.mockImplementation(async ({ data }) => ({
      ...SHARED,
      ...data,
    }));
    scheduleCreate.mockImplementation(async ({ data }) => data);
  });

  it("lets any member with access edit and delete a schedule another member wrote", async () => {
    await expect(
      updateSokoBotSchedule(
        { userId: "member_2", ...turnRef(SHARED), enabled: false },
        tx,
      ),
    ).resolves.toMatchObject({ id: SHARED.id, enabled: false });
    await expect(
      deleteSokoBotSchedule("member_2", turnRef(SHARED), tx),
    ).resolves.toEqual({ id: SHARED.id, name: SHARED.name });
    expect(scheduleFindFirst).toHaveBeenLastCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        sokoBotId: SHARED_BOT_ID,
        OR: [{ id: SHARED.id }],
      },
    });
    expect(scheduleDelete).toHaveBeenCalledWith({ where: { id: SHARED.id } });
  });

  it.each([
    ["a prompt edit", { prompt: "New" }],
    ["a cron edit", { cronExpression: "0 10 * * 1" }],
    ["a timezone edit", { timezone: "Europe/Berlin" }],
    ["a pause", { enabled: false }],
    ["a rename", { name: "Renamed" }],
  ])(
    "keeps a shared schedule's Requester on %s by another member",
    async (_label, edit) => {
      await updateSokoBotSchedule(
        { userId: "member_2", ...turnRef(SHARED), ...edit },
        tx,
      );
      const data = scheduleUpdate.mock.lastCall?.[0]?.data;
      expect(scheduleUpdate.mock.lastCall?.[0]?.where).toEqual({
        id: SHARED.id,
      });
      expect(data).not.toHaveProperty("requestedByUserId");
      expect(data).not.toHaveProperty("userId");
    },
  );

  it.each([
    ["a non-member", "outsider", turnRef(SHARED)],
    ["the author after leaving", "author_1", turnRef(SHARED)],
    ["the author after leaving, through `me`", "author_1", meRef(SHARED)],
    ["another member's personal schedule", "member_2", turnRef(PERSONAL)],
  ])("does not find a schedule for %s", async (_label, userId, ref) => {
    members.delete("author_1");
    await expect(deleteSokoBotSchedule(userId, ref, tx)).rejects.toThrow(
      SokoBotScheduleNotFoundError,
    );
    expect(scheduleDelete).not.toHaveBeenCalled();
  });

  it("does not find the caller's own shared schedule through `me`", async () => {
    await expect(
      updateSokoBotSchedule(
        { userId: "author_1", ...meRef(SHARED), enabled: false },
        tx,
      ),
    ).rejects.toThrow(SokoBotScheduleNotFoundError);
    expect(scheduleFindFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: undefined,
        sokoBotId: undefined,
        sokoBot: { userId: "author_1" },
        OR: [{ id: SHARED.id }],
      },
    });
    expect(botFindFirst).not.toHaveBeenCalled();
    expect(scheduleUpdate).not.toHaveBeenCalled();
  });

  it("finds a personal owner's own schedule without asking for the bot", async () => {
    await expect(
      deleteSokoBotSchedule("owner_1", meRef(PERSONAL), tx),
    ).resolves.toEqual({ id: PERSONAL.id, name: PERSONAL.name });
    expect(botFindFirst).not.toHaveBeenCalled();
  });

  it("creates on the turn's own bot, not the member's personal one", async () => {
    scheduleFindFirst.mockResolvedValueOnce(null);
    await createSokoBotSchedule(
      {
        userId: "member_2",
        workspaceId: WORKSPACE_ID,
        sokoBotId: SHARED_BOT_ID,
        name: "Check-in",
        timezone: "UTC",
        cronExpression: "0 9 * * 1",
        prompt: "How is it going?",
      },
      tx,
    );
    expect(botFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SHARED_BOT_ID }),
      }),
    );
    expect(scheduleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sokoBotId: SHARED_BOT_ID,
        requestedByUserId: "member_2",
      }),
    });
  });

  describe("upserting a schedule by name", () => {
    const upsert = (
      row: typeof SHARED,
      userId: string,
      edit: Partial<{
        prompt: string;
        cronExpression: string;
        timezone: string;
      }>,
    ) =>
      createSokoBotSchedule(
        {
          userId,
          workspaceId: WORKSPACE_ID,
          sokoBotId: row.sokoBotId,
          name: row.name,
          timezone: row.timezone,
          cronExpression: row.cronExpression,
          prompt: row.prompt,
          ...edit,
        },
        tx,
      );
    /** The Requester the upsert wrote to `row`; `undefined` keeps it. */
    const storedRequester = (row: typeof SHARED) => {
      const call = scheduleUpdate.mock.lastCall?.[0];
      expect(call?.where).toEqual({ id: row.id });
      return call?.data.requestedByUserId;
    };

    it.each([
      ["a new prompt", { prompt: "New" }],
      ["a new cron", { cronExpression: "0 10 * * 1" }],
      ["a new timezone", { timezone: "Europe/Berlin" }],
      ["no change", {}],
    ])(
      "keeps a shared schedule's Requester when another member upserts %s",
      async (_label, edit) => {
        await upsert(SHARED, "member_2", edit);
        expect(storedRequester(SHARED)).toBeUndefined();
      },
    );

    it("leaves a personal schedule with its owner", async () => {
      await upsert(PERSONAL, "owner_1", { prompt: "New" });
      expect(storedRequester(PERSONAL)).toBeUndefined();
    });
  });
});
