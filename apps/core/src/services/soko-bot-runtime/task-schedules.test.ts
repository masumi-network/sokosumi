import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  changeState: vi.fn(),
  remove: vi.fn(),
  findReadable: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { workspace: { findUniqueOrThrow: mocks.workspace } },
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn(),
}));
vi.mock("@/services/task-schedule.service", () => ({
  createTaskSchedule: mocks.create,
  updateTaskSchedule: mocks.update,
  changeTaskScheduleState: mocks.changeState,
  deleteTaskSchedule: mocks.remove,
}));
vi.mock("@/services/task-schedule-read.service", () => ({
  findReadableSchedule: mocks.findReadable,
}));

import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import type { RuntimeOperations } from "./operations";
import { removeTaskSchedule, saveTaskSchedule } from "./task-schedules";

const runtime = {
  commitReceipt: vi.fn(
    async (_authorized: unknown, _id: string, _target: string, result) =>
      result,
  ),
} as unknown as RuntimeOperations;

function authorized(
  overrides: { askedByKind?: string; source?: string; shared?: boolean } = {},
) {
  return {
    turn: {
      id: "turn-1",
      sokoBotId: "joseph",
      workspaceId: "ws-1",
      actingUserId: "patrick",
      versionId: "v38",
      source: overrides.source ?? "CHAT",
      chainDepth: 0,
    },
    askedByKind: overrides.askedByKind ?? "OWNER",
    reader: { sharedScope: overrides.shared ? { kind: "workspace" } : null },
  } as unknown as AuthorizedSokoBotRuntime;
}

const call = (input: Record<string, unknown>) => ({
  capability: "save_task_schedule" as const,
  sessionId: "session-1",
  turnId: "turn-1",
  toolCallId: "call-1",
  input,
});

const SCHEDULE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Daily competitor research",
  state: "ACTIVE",
  expr: "0 9 * * 1-5",
  timezone: "Europe/Berlin",
  nextRunAt: new Date("2026-11-27T08:00:00Z"),
  revision: 4,
  intervalDays: null,
  anchorAt: new Date("2026-11-01T08:00:00Z"),
  endsMode: "NEVER",
  endsOn: null,
  targetRunCount: null,
  creatorUserId: "patrick",
  creatorSokoBotId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({
    id: "ws-1",
    userId: null,
    organizationId: "org-1",
  });
  mocks.create.mockResolvedValue(SCHEDULE);
  mocks.update.mockResolvedValue(SCHEDULE);
  mocks.changeState.mockResolvedValue({ ...SCHEDULE, state: "PAUSED" });
  mocks.findReadable.mockResolvedValue(SCHEDULE);
});

describe("saveTaskSchedule", () => {
  it("creates one as the owner, with the bot as Creator and the cadence as its rule", async () => {
    const result = await saveTaskSchedule(
      runtime,
      call({
        name: "Daily competitor research",
        brief: "Post the competitor moves in the Launch room.",
        assigneeCoworkerId: "mira",
        cron: "0 9 * * 1-5",
        timezone: "Europe/Berlin",
      }),
      authorized(),
    );
    const [actor, request] = mocks.create.mock.calls[0];
    expect(actor).toEqual(
      expect.objectContaining({
        kind: "user",
        userId: "patrick",
        sokoBotId: "joseph",
      }),
    );
    expect(request).toEqual(
      expect.objectContaining({
        description: "Post the competitor moves in the Launch room.",
        assigneeId: "mira",
        rule: expect.objectContaining({
          expr: "0 9 * * 1-5",
          timezone: "Europe/Berlin",
          endsMode: "NEVER",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        created: true,
        taskSchedule: expect.objectContaining({ cron: "0 9 * * 1-5" }),
      }),
    );
  });

  it("changes only what it was given, against the current revision, then pauses", async () => {
    await saveTaskSchedule(
      runtime,
      call({ scheduleId: SCHEDULE.id, endsOn: "2026-12-31", state: "PAUSED" }),
      authorized(),
    );
    const [, id, request] = mocks.update.mock.calls[0];
    expect(id).toBe(SCHEDULE.id);
    expect(request).toEqual(
      expect.objectContaining({
        expectedRevision: 4,
        rule: expect.objectContaining({
          expr: "0 9 * * 1-5",
          endsMode: "ON",
          endsOn: "2026-12-31T23:59:59.000Z",
        }),
      }),
    );
    expect(request.name).toBeUndefined();
    expect(mocks.changeState).toHaveBeenCalledWith(
      expect.anything(),
      SCHEDULE.id,
      "pause",
    );
  });

  it("changes someone else's schedule only on the owner's own chat turn", async () => {
    mocks.findReadable.mockResolvedValue({
      ...SCHEDULE,
      creatorUserId: "jami",
    });
    await expect(
      saveTaskSchedule(
        runtime,
        call({ scheduleId: SCHEDULE.id, name: "Renamed" }),
        authorized({ source: "SCHEDULE" }),
      ),
    ).rejects.toThrow(/made by someone else/);
    await saveTaskSchedule(
      runtime,
      call({ scheduleId: SCHEDULE.id, state: "PAUSED" }),
      authorized(),
    );
    expect(mocks.changeState).toHaveBeenCalledTimes(1);
  });

  it("refuses a teammate's turn and a shared bot", async () => {
    for (const turn of [
      authorized({ askedByKind: "TEAMMATE" }),
      authorized({ shared: true }),
    ])
      await expect(
        saveTaskSchedule(runtime, call({ name: "x", cron: "0 9 * * *" }), turn),
      ).rejects.toThrow(/owner's own turn/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("saveTaskSchedule retries and states", () => {
  it("sends the same operation id for every attempt of one tool call", async () => {
    const create = call({ name: "Daily research", cron: "0 9 * * 1-5" });
    await saveTaskSchedule(runtime, create, authorized());
    await saveTaskSchedule(runtime, create, authorized());
    const [first, second] = mocks.create.mock.calls.map(
      ([, request]) => request.operationId,
    );
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).toBe(first);
    await saveTaskSchedule(
      runtime,
      { ...create, toolCallId: "call-2" },
      authorized(),
    );
    expect(mocks.create.mock.calls[2]?.[1].operationId).not.toBe(first);
  });

  it("refuses to create a schedule that is already ENDED, before writing", async () => {
    await expect(
      saveTaskSchedule(
        runtime,
        call({ name: "x", cron: "0 9 * * *", state: "ENDED" }),
        authorized(),
      ),
    ).rejects.toThrow(/starts ACTIVE or PAUSED/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not pause twice when a replay returns the schedule already paused", async () => {
    mocks.create.mockResolvedValue({ ...SCHEDULE, state: "PAUSED" });
    await saveTaskSchedule(
      runtime,
      call({ name: "x", cron: "0 9 * * *", state: "PAUSED" }),
      authorized(),
    );
    expect(mocks.changeState).not.toHaveBeenCalled();
  });
});

describe("a scheduled run", () => {
  it("never deletes, pauses or ends a Task Schedule", async () => {
    const run = authorized({ source: "SCHEDULE" });
    for (const change of [
      { state: "PAUSED" },
      { state: "ENDED" },
      { endsOn: "2026-12-31" },
      { endsAfterRuns: 1 },
    ])
      await expect(
        saveTaskSchedule(
          runtime,
          call({ scheduleId: SCHEDULE.id, ...change }),
          run,
        ),
      ).rejects.toThrow(/scheduled run doesn't delete, pause or end/);
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(
      removeTaskSchedule(
        runtime,
        {
          ...call({ scheduleId: SCHEDULE.id }),
          capability: "delete_task_schedule",
        },
        run,
      ),
    ).rejects.toThrow(/scheduled run doesn't delete, pause or end/);
    expect(mocks.changeState).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("removeTaskSchedule", () => {
  it("deletes one the owner made", async () => {
    const result = await removeTaskSchedule(
      runtime,
      {
        ...call({ scheduleId: SCHEDULE.id }),
        capability: "delete_task_schedule",
      },
      authorized(),
    );
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), SCHEDULE.id);
    expect(result).toEqual(expect.objectContaining({ deleted: true }));
  });
});
