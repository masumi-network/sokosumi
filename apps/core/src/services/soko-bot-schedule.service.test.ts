import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn(),
}));

import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";

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
    runOnce: false,
    nextRunAt: new Date("2099-01-01T09:00:00.000Z"),
    systemKey: null as string | null,
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
  const scheduleUpdateMany = vi.fn();
  const scheduleDelete = vi.fn();
  /** The row and its run changes as read under the lock. */
  let locked: Record<string, unknown>;
  let runChanges: { originalAt: Date; scheduledAt: Date | null }[];
  const queryRaw = vi.fn();
  const lockedFindUnique = vi.fn(async () => ({ ...locked, runChanges }));
  const changeUpsert = vi.fn();
  const changeDeleteMany = vi.fn();
  const scheduleCreate = vi.fn();
  const botFindUnique = vi.fn(async (args: { where: { id: string } }) => ({
    userId: BOT_OWNERS[args.where.id],
    workspace: { organizationId: "org_1" },
  }));
  const tx = {
    $queryRaw: queryRaw,
    sokoBotScheduleRunChange: {
      findMany: vi.fn(async () => runChanges),
      upsert: changeUpsert,
      deleteMany: changeDeleteMany,
    },
    sokoBot: { findFirst: botFindFirst, findUnique: botFindUnique },
    workspace: { findFirst: vi.fn().mockResolvedValue({ id: WORKSPACE_ID }) },
    sokoBotSchedule: {
      findFirst: scheduleFindFirst,
      findMany: scheduleFindMany,
      update: scheduleUpdate,
      updateMany: scheduleUpdateMany,
      findUniqueOrThrow: lockedFindUnique,
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
    scheduleUpdateMany.mockResolvedValue({ count: 1 });
    locked = { ...SHARED };
    runChanges = [];
  });

  describe("changing one run from the Calendar", () => {
    // Mondays 09:00 UTC; the next run is 2099-01-05 (a Monday).
    const NEXT = new Date("2099-01-05T09:00:00.000Z");
    const LATER = new Date("2099-01-12T09:00:00.000Z");
    const AFTER = new Date("2099-01-19T09:00:00.000Z");
    const NOW = new Date("2098-12-31T00:00:00.000Z");
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      locked = { ...SHARED, nextRunAt: NEXT };
    });
    afterEach(() => vi.useRealTimers());

    const change = (
      row: typeof SHARED,
      run: {
        originalAt: Date;
        expectedAt: Date | null;
        action: "skip" | "move" | "restore";
        scheduledAt?: Date;
      },
      userId = "member_2",
    ) =>
      updateSokoBotSchedule(
        {
          userId,
          ...turnRef(row),
          run: {
            ...run,
            originalAt: run.originalAt.toISOString(),
            expectedAt: run.expectedAt?.toISOString() ?? null,
            scheduledAt: run.scheduledAt?.toISOString(),
          },
        },
        tx,
      );
    const lastSchedule = () => scheduleUpdate.mock.lastCall?.[0];

    it("lets any member skip a later run; the next run and the cron stay", async () => {
      await change(SHARED, {
        originalAt: LATER,
        expectedAt: LATER,
        action: "skip",
      });
      // Locked before it read what it checks.
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        lockedFindUnique.mock.invocationCallOrder[0] ?? 0,
      );
      expect(changeUpsert).toHaveBeenCalledWith({
        where: {
          scheduleId_originalAt: { scheduleId: SHARED.id, originalAt: LATER },
        },
        create: { scheduleId: SHARED.id, originalAt: LATER, scheduledAt: null },
        update: { scheduledAt: null },
      });
      expect(lastSchedule()).toEqual({
        where: { id: SHARED.id },
        data: { nextRunAt: NEXT },
      });
    });

    it("walks the next run on past a skipped next run", async () => {
      await change(SHARED, {
        originalAt: NEXT,
        expectedAt: NEXT,
        action: "skip",
      });
      expect(lastSchedule().data).toEqual({ nextRunAt: LATER });
    });

    it("moves a later run before the next one, which then runs first", async () => {
      const moved = new Date("2099-01-03T15:30:00.000Z");
      locked = { ...PERSONAL, nextRunAt: NEXT };
      await change(
        PERSONAL,
        {
          originalAt: AFTER,
          expectedAt: AFTER,
          action: "move",
          scheduledAt: moved,
        },
        "owner_1",
      );
      expect(changeUpsert.mock.lastCall?.[0].create).toEqual({
        scheduleId: PERSONAL.id,
        originalAt: AFTER,
        scheduledAt: moved,
      });
      expect(lastSchedule().data).toEqual({ nextRunAt: moved });
    });

    it("restores a moved run to its own time and drops the change", async () => {
      const moved = new Date("2099-01-13T10:00:00.000Z");
      runChanges = [{ originalAt: LATER, scheduledAt: moved }];
      await change(SHARED, {
        originalAt: LATER,
        expectedAt: moved,
        action: "restore",
      });
      expect(changeDeleteMany).toHaveBeenCalledWith({
        where: { scheduleId: SHARED.id, originalAt: LATER },
      });
      expect(changeUpsert).not.toHaveBeenCalled();
    });

    it("undoes a skip of a moved run by moving it back, expecting it skipped", async () => {
      const moved = new Date("2099-01-13T10:00:00.000Z");
      runChanges = [{ originalAt: LATER, scheduledAt: null }];
      await change(SHARED, {
        originalAt: LATER,
        expectedAt: null,
        action: "move",
        scheduledAt: moved,
      });
      expect(changeUpsert.mock.lastCall?.[0].update).toEqual({
        scheduledAt: moved,
      });
    });

    it.each([
      ["a time it no longer has", { expectedAt: LATER, skipped: false }],
      [
        "a skipped run seen as still there",
        { expectedAt: LATER, skipped: true },
      ],
    ])("answers 409 for %s", async (_label, { expectedAt, skipped }) => {
      runChanges = [
        {
          originalAt: LATER,
          scheduledAt: skipped ? null : new Date("2099-01-14T09:00:00.000Z"),
        },
      ];
      await expect(
        change(SHARED, { originalAt: LATER, expectedAt, action: "skip" }),
      ).rejects.toMatchObject({ status: 409 });
      expect(changeUpsert).not.toHaveBeenCalled();
    });

    it("answers 409 for a run that is due or fired", async () => {
      vi.setSystemTime(new Date(NEXT.getTime() + 1));
      await expect(
        change(SHARED, { originalAt: NEXT, expectedAt: NEXT, action: "skip" }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it.each([
      ["onto another run", LATER],
      ["into the past", new Date("2098-12-30T09:00:00.000Z")],
      ["beyond the planning window", new Date("2099-06-01T09:00:00.000Z")],
    ])("refuses a move %s", async (_label, scheduledAt) => {
      await expect(
        change(SHARED, {
          originalAt: NEXT,
          expectedAt: NEXT,
          action: "move",
          scheduledAt,
        }),
      ).rejects.toThrow(SokoBotScheduleValidationError);
      expect(changeUpsert).not.toHaveBeenCalled();
    });

    it("refuses a time that is not one of the schedule's runs", async () => {
      const notARun = new Date("2099-01-06T09:00:00.000Z");
      await expect(
        change(SHARED, {
          originalAt: notARun,
          expectedAt: notARun,
          action: "skip",
        }),
      ).rejects.toThrow(/no run at originalAt/);
    });

    it.each([
      ["a non-member", "outsider", SHARED],
      ["another member's personal bot", "member_2", PERSONAL],
    ])("finds no schedule for %s", async (_label, userId, row) => {
      await expect(
        change(
          row,
          { originalAt: NEXT, expectedAt: NEXT, action: "skip" },
          userId,
        ),
      ).rejects.toThrow(SokoBotScheduleNotFoundError);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it("refuses a member without a Seat on a shared bot", async () => {
      vi.mocked(requireAssignedOrganizationSeat).mockRejectedValueOnce(
        new Error("An assigned seat is required"),
      );
      await expect(
        change(SHARED, { originalAt: NEXT, expectedAt: NEXT, action: "skip" }),
      ).rejects.toThrow("An assigned seat is required");
      expect(changeUpsert).not.toHaveBeenCalled();
    });

    it("leaves a built-in rhythm's runs alone", async () => {
      scheduleFindFirst.mockResolvedValueOnce({
        ...SHARED,
        systemKey: "dream",
      });
      await expect(
        change(SHARED, { originalAt: NEXT, expectedAt: NEXT, action: "skip" }),
      ).rejects.toThrow(SokoBotScheduleValidationError);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it("moves a one-time run with its display cron", async () => {
      locked = { ...SHARED, runOnce: true, nextRunAt: NEXT };
      await change(SHARED, {
        originalAt: NEXT,
        expectedAt: NEXT,
        action: "move",
        scheduledAt: new Date("2099-03-04T10:15:00.000Z"),
      });
      expect(lastSchedule().data).toEqual({
        enabled: true,
        nextRunAt: new Date("2099-03-04T10:15:00.000Z"),
        cronExpression: "15 10 4 3 *",
      });
    });

    it("skips a one-time run by switching it off, and Undo switches it back on", async () => {
      locked = { ...SHARED, runOnce: true, nextRunAt: NEXT };
      await change(SHARED, {
        originalAt: NEXT,
        expectedAt: NEXT,
        action: "skip",
      });
      expect(lastSchedule().data).toEqual({ enabled: false });

      locked = { ...locked, enabled: false };
      // Seen skipped: a second skip or a stale view is refused.
      await expect(
        change(SHARED, { originalAt: NEXT, expectedAt: NEXT, action: "skip" }),
      ).rejects.toMatchObject({ status: 409 });
      await change(SHARED, {
        originalAt: NEXT,
        expectedAt: null,
        action: "restore",
      });
      expect(lastSchedule().data).toEqual({ enabled: true });
    });

    it("never changes a one-time run that already ran", async () => {
      locked = {
        ...SHARED,
        runOnce: true,
        enabled: false,
        lastRunAt: NEXT,
        nextRunAt: NEXT,
      };
      await expect(
        change(SHARED, {
          originalAt: NEXT,
          expectedAt: null,
          action: "restore",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(scheduleUpdate).not.toHaveBeenCalled();
    });

    it("drops moved and skipped runs when the cron changes", async () => {
      await updateSokoBotSchedule(
        {
          userId: "member_2",
          ...turnRef(SHARED),
          cronExpression: "0 10 * * 2",
        },
        tx,
      );
      expect(lastSchedule().data.runChanges).toEqual({ deleteMany: {} });
      expect(lastSchedule().data.cronExpression).toBe("0 10 * * 2");
    });
  });

  it("keeps a built-in rhythm as it is for a bot that may not change its own, and lets a person", async () => {
    const rhythm = {
      ...SHARED,
      name: "Weekly review",
      systemKey: "cmo-weekly-review",
    };
    scheduleFindFirst.mockResolvedValueOnce(rhythm);
    await expect(
      updateSokoBotSchedule(
        {
          userId: "member_2",
          ...turnRef(SHARED),
          prompt: "Remind the owner every Monday.",
          keepBuiltInRhythms: true,
        },
        tx,
      ),
    ).rejects.toThrow(
      '"Weekly review" is one of your built-in rhythms and stays as it is',
    );
    expect(scheduleUpdate).not.toHaveBeenCalled();

    // A schedule the bot or a member set up is still the bot's to change.
    await expect(
      updateSokoBotSchedule(
        {
          userId: "member_2",
          ...turnRef(SHARED),
          enabled: false,
          keepBuiltInRhythms: true,
        },
        tx,
      ),
    ).resolves.toMatchObject({ id: SHARED.id, enabled: false });

    // A person pauses a rhythm as before.
    scheduleFindFirst.mockResolvedValueOnce(rhythm);
    await expect(
      updateSokoBotSchedule(
        { userId: "member_2", ...turnRef(SHARED), enabled: false },
        tx,
      ),
    ).resolves.toMatchObject({ enabled: false });
  });

  it("keeps a built-in rhythm's name and prompt, for a person too: another job is its own schedule", async () => {
    const rhythm = {
      ...SHARED,
      name: "End of day",
      prompt: "End of day. What got done.",
      systemKey: "end-of-day",
    };
    for (const change of [
      { name: "End of day: CodePat runs + merged PRs" },
      { prompt: "List today's CodePat runs and merged PRs." },
    ]) {
      scheduleFindFirst.mockResolvedValueOnce(rhythm);
      await expect(
        updateSokoBotSchedule(
          { userId: "member_2", ...turnRef(SHARED), ...change },
          tx,
        ),
      ).rejects.toThrow(
        '"End of day" is a built-in rhythm: only its time, timezone and on/off change',
      );
    }
    expect(scheduleUpdate).not.toHaveBeenCalled();

    // The console sends the whole form back: unchanged values pass.
    scheduleFindFirst.mockResolvedValueOnce(rhythm);
    await expect(
      updateSokoBotSchedule(
        {
          userId: "member_2",
          ...turnRef(SHARED),
          name: rhythm.name,
          prompt: rhythm.prompt,
          cronExpression: "0 19 * * 1-5",
        },
        tx,
      ),
    ).resolves.toBeDefined();
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

  const SEAT_REQUIRED = new Error("An assigned seat is required");
  const createInput = (userId: string | null, sokoBotId: string) => ({
    userId,
    workspaceId: WORKSPACE_ID,
    sokoBotId,
    name: "Check-in",
    timezone: "UTC",
    cronExpression: "0 9 * * 1",
    prompt: "How is it going?",
  });

  it.each([
    [
      "creating",
      () => createSokoBotSchedule(createInput("member_2", SHARED_BOT_ID), tx),
    ],
    [
      "changing",
      () =>
        updateSokoBotSchedule(
          { userId: "member_2", ...turnRef(SHARED), prompt: "New" },
          tx,
        ),
    ],
  ])(
    "refuses a member without a Seat %s a shared bot's schedule",
    async (_label, write) => {
      vi.mocked(requireAssignedOrganizationSeat).mockRejectedValueOnce(
        SEAT_REQUIRED,
      );
      await expect(write()).rejects.toBe(SEAT_REQUIRED);
      expect(requireAssignedOrganizationSeat).toHaveBeenCalledWith(
        "member_2",
        "org_1",
        tx,
      );
      expect(scheduleCreate).not.toHaveBeenCalled();
      expect(scheduleUpdate).not.toHaveBeenCalled();
    },
  );

  it("asks no Seat for a personal bot or a shared bot acting on its own", async () => {
    await updateSokoBotSchedule(
      { userId: "owner_1", ...meRef(PERSONAL), prompt: "New" },
      tx,
    );
    expect(scheduleUpdate.mock.lastCall?.[0]?.data).toStrictEqual({
      prompt: "New",
    });
    // The runtime's own lookup: the shared bot, in its workspace.
    botFindFirst.mockResolvedValueOnce({
      id: SHARED_BOT_ID,
      userId: null,
      workspaceId: WORKSPACE_ID,
      archivedAt: null,
    } as never);
    scheduleFindFirst.mockResolvedValueOnce(null);
    await createSokoBotSchedule(createInput(null, SHARED_BOT_ID), tx);
    expect(scheduleCreate).toHaveBeenCalled();
    expect(requireAssignedOrganizationSeat).not.toHaveBeenCalled();
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
