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
  const BOT_ID = "01960001-0001-7001-8001-000000000001";
  const WORKSPACE_ID = "01960001-0001-7001-8001-0000000000aa";
  const SCHEDULE = {
    id: "01960001-0001-7001-8001-0000000000cc",
    sokoBotId: BOT_ID,
    userId: "author_1",
    workspaceId: WORKSPACE_ID,
    name: "Stand-up",
    timezone: "UTC",
    cronExpression: "0 9 * * 1",
    enabled: true,
    nextRunAt: new Date("2099-01-01T09:00:00.000Z"),
    systemKey: null,
  };
  const ref = {
    scheduleId: SCHEDULE.id,
    workspaceId: WORKSPACE_ID,
    sokoBotId: BOT_ID,
  };
  const botFindFirst = vi.fn();
  const scheduleFindFirst = vi.fn();
  const scheduleFindMany = vi.fn();
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
  const botRow = (userId: string | null) => ({
    id: BOT_ID,
    userId,
    workspaceId: WORKSPACE_ID,
    workspace: { organizationId: "org_1" },
  });
  /** The author's lookup carries their `userId`; the shared lookup carries none. */
  const authorOrSharedLookup = () =>
    scheduleFindFirst.mockImplementation(
      async (args: { where: { userId?: string } }) =>
        args.where.userId === undefined || args.where.userId === SCHEDULE.userId
          ? SCHEDULE
          : null,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleFindMany.mockResolvedValue([]);
    scheduleUpdate.mockImplementation(async ({ data }) => ({
      ...SCHEDULE,
      ...data,
    }));
    scheduleCreate.mockImplementation(async ({ data }) => data);
  });

  it("lets any member with access edit and delete a schedule another member wrote", async () => {
    botFindFirst.mockResolvedValue(botRow(null));
    authorOrSharedLookup();
    await expect(
      updateSokoBotSchedule({ userId: "member_2", ...ref, enabled: false }, tx),
    ).resolves.toMatchObject({ id: SCHEDULE.id, enabled: false });
    await expect(deleteSokoBotSchedule("member_2", ref, tx)).resolves.toEqual({
      id: SCHEDULE.id,
      name: SCHEDULE.name,
    });
    expect(scheduleFindFirst).toHaveBeenLastCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        sokoBotId: BOT_ID,
        OR: [{ id: SCHEDULE.id }],
      },
    });
    expect(scheduleDelete).toHaveBeenCalledWith({ where: { id: SCHEDULE.id } });
  });

  it("asks the bot as the caller, so a non-member is not let in", async () => {
    botFindFirst.mockResolvedValue(null);
    authorOrSharedLookup();
    await expect(deleteSokoBotSchedule("outsider", ref, tx)).rejects.toThrow(
      SokoBotScheduleNotFoundError,
    );
    expect(botFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: BOT_ID }),
      }),
    );
    expect(scheduleDelete).not.toHaveBeenCalled();
  });

  it("keeps a personal bot's schedules with their author", async () => {
    botFindFirst.mockResolvedValue(botRow("owner_1"));
    authorOrSharedLookup();
    await expect(deleteSokoBotSchedule("owner_1", ref, tx)).rejects.toThrow(
      SokoBotScheduleNotFoundError,
    );
    expect(scheduleFindFirst).toHaveBeenCalledOnce();
    expect(scheduleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner_1",
          workspaceId: WORKSPACE_ID,
          sokoBotId: BOT_ID,
        },
      }),
    );
  });

  it("finds the author's own schedule without asking for the bot", async () => {
    authorOrSharedLookup();
    await expect(
      deleteSokoBotSchedule(SCHEDULE.userId, ref, tx),
    ).resolves.toEqual({ id: SCHEDULE.id, name: SCHEDULE.name });
    expect(botFindFirst).not.toHaveBeenCalled();
  });

  it("creates on the turn's own bot, not the member's personal one", async () => {
    botFindFirst.mockResolvedValue(botRow(null));
    scheduleFindFirst.mockResolvedValue(null);
    await createSokoBotSchedule(
      {
        userId: "member_2",
        workspaceId: WORKSPACE_ID,
        sokoBotId: BOT_ID,
        name: "Check-in",
        timezone: "UTC",
        cronExpression: "0 9 * * 1",
        prompt: "How is it going?",
      },
      tx,
    );
    expect(botFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: BOT_ID }),
      }),
    );
    expect(scheduleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sokoBotId: BOT_ID, userId: "member_2" }),
    });
  });
});
