import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getTaskScheduleOccurrencesMock = vi.fn();
const putTaskCalendarScheduleMock = vi.fn();
const putTaskCalendarSourceMock = vi.fn();
const putTaskScheduleMock = vi.fn();
const deleteTaskScheduleMock = vi.fn();
const mutateTaskScheduleOccurrenceMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getTaskScheduleOccurrences: (...args: unknown[]) =>
      getTaskScheduleOccurrencesMock(...args),
    putTaskCalendarSchedule: (...args: unknown[]) =>
      putTaskCalendarScheduleMock(...args),
    putTaskCalendarSource: (...args: unknown[]) =>
      putTaskCalendarSourceMock(...args),
    putTaskSchedule: (...args: unknown[]) => putTaskScheduleMock(...args),
    deleteTaskSchedule: (...args: unknown[]) => deleteTaskScheduleMock(...args),
    mutateTaskScheduleOccurrence: (...args: unknown[]) =>
      mutateTaskScheduleOccurrenceMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.request";

import { taskScheduleService } from "./task-schedule.service";

const occurrence = {
  id: "33333333-3333-4333-8333-333333333333",
  state: "PLANNED" as const,
  scheduleVersion: 2,
  epochId: "44444444-4444-4444-8444-444444444444",
  originalScheduledAt: new Date("2026-09-10T07:00:00.000Z"),
  effectiveScheduledAt: new Date("2026-09-10T09:00:00.000Z"),
  timezone: "Europe/Berlin",
  isMissed: false,
  sourceId: "workspace:11111111-1111-4111-8111-111111111111",
  sourceWorkspaceId: "11111111-1111-4111-8111-111111111111",
  sourceType: "WORKSPACE" as const,
  sourceProjectId: null,
  sourceAccuracy: "EXACT" as const,
  timeAccuracy: "EXACT" as const,
  releasedTask: null,
};

describe("taskScheduleService.listOccurrences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the first page of a view and returns the observed revision", async () => {
    getTaskScheduleOccurrencesMock.mockResolvedValue({
      data: {
        scheduleRevision: 4,
        futureExceptionCount: 2,
        occurrences: [occurrence],
      },
      meta: { pagination: { nextCursor: "cursor-2" } },
    });

    const page = await taskScheduleService.listOccurrences("task_1", {
      view: "upcoming",
      limit: 10,
    });

    expect(getTaskScheduleOccurrencesMock).toHaveBeenCalledWith("task_1", {
      view: "upcoming",
      cursor: undefined,
      limit: 10,
    });
    expect(page).toEqual({
      scheduleRevision: 4,
      futureExceptionCount: 2,
      occurrences: [occurrence],
      nextCursor: "cursor-2",
    });
  });

  it("reads the bounded series state used by edit preconditions", async () => {
    getTaskScheduleOccurrencesMock.mockResolvedValue({
      data: {
        scheduleRevision: 4,
        futureExceptionCount: 2,
        occurrences: [],
      },
      meta: { pagination: { nextCursor: null } },
    });

    await expect(
      taskScheduleService.readSeriesState("task_1"),
    ).resolves.toEqual({
      scheduleRevision: 4,
      futureExceptionCount: 2,
    });
    expect(getTaskScheduleOccurrencesMock).toHaveBeenCalledWith("task_1", {
      view: "upcoming",
      cursor: undefined,
      limit: 1,
    });
  });

  it("forwards a cursor page and reports the end of the view as a null cursor", async () => {
    getTaskScheduleOccurrencesMock.mockResolvedValue({
      data: { scheduleRevision: 4, futureExceptionCount: 0, occurrences: [] },
      meta: { pagination: { nextCursor: null } },
    });

    const page = await taskScheduleService.listOccurrences("task_1", {
      view: "history",
      cursor: "cursor-2",
      limit: 10,
    });

    expect(getTaskScheduleOccurrencesMock).toHaveBeenCalledWith("task_1", {
      view: "history",
      cursor: "cursor-2",
      limit: 10,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.occurrences).toEqual([]);
  });

  it("treats a response without pagination metadata as the last page", async () => {
    getTaskScheduleOccurrencesMock.mockResolvedValue({
      data: { scheduleRevision: 0, futureExceptionCount: 0, occurrences: [] },
    });

    await expect(
      taskScheduleService.listOccurrences("task_1", { view: "history" }),
    ).resolves.toEqual({
      scheduleRevision: 0,
      futureExceptionCount: 0,
      occurrences: [],
      nextCursor: null,
    });
  });

  it("propagates the stable Core error kind so callers can detect a stale cursor", async () => {
    getTaskScheduleOccurrencesMock.mockRejectedValue(
      new CoreApiRequestError("The schedule series changed", {
        kind: CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE,
        status: 409,
      }),
    );

    await expect(
      taskScheduleService.listOccurrences("task_1", {
        view: "upcoming",
        cursor: "stale",
      }),
    ).rejects.toMatchObject({
      kind: CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE,
      status: 409,
    });
  });
});

describe("taskScheduleService series mutations", () => {
  const operationId = "123e4567-e89b-42d3-a456-426614174000";
  const recurring = {
    mode: "recurring" as const,
    expr: "0 9 * * *",
    timezone: "UTC",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("edits an active series with its operation, observed revision, and discard confirmation", async () => {
    putTaskCalendarScheduleMock.mockResolvedValue({
      data: { id: "task_1", scheduleRevision: 5 },
    });

    const task = await taskScheduleService.editCalendarSeries(
      "task_1",
      { operationId, expectedScheduleRevision: 4 },
      recurring,
    );

    expect(putTaskCalendarScheduleMock).toHaveBeenCalledWith("task_1", {
      operationId,
      expectedScheduleRevision: 4,
      discardFutureExceptions: true,
      schedule: recurring,
    });
    expect(task).toEqual({ id: "task_1", scheduleRevision: 5 });
  });

  it("removes a series through the revision-safe precondition", async () => {
    deleteTaskScheduleMock.mockResolvedValue({
      data: { id: "task_1", scheduleRevision: 5 },
    });

    const task = await taskScheduleService.removeCalendarSeries("task_1", {
      operationId,
      expectedScheduleRevision: 4,
    });

    expect(deleteTaskScheduleMock).toHaveBeenCalledWith("task_1", {
      operationId,
      expectedScheduleRevision: 4,
    });
    expect(task).toEqual({ id: "task_1", scheduleRevision: 5 });
  });

  it("moves a live series with its operation and observed revision", async () => {
    const mutation = {
      previousSource: { type: "workspace" as const },
      source: {
        type: "project" as const,
        projectId: "11111111-1111-4111-8111-111111111111",
      },
      scheduleRevision: 5,
      canceledFutureExceptionCount: 2,
    };
    putTaskCalendarSourceMock.mockResolvedValue({ data: mutation });

    const result = await taskScheduleService.moveCalendarSeriesSource(
      "task_1",
      { operationId, expectedScheduleRevision: 4 },
      mutation.source,
    );

    expect(putTaskCalendarSourceMock).toHaveBeenCalledWith("task_1", {
      operationId,
      expectedScheduleRevision: 4,
      discardFutureExceptions: true,
      source: mutation.source,
    });
    expect(result).toEqual(mutation);
  });

  it("keeps the legacy bare schedule write for a Task that has no series yet", async () => {
    putTaskScheduleMock.mockResolvedValue({ data: { id: "task_1" } });

    await taskScheduleService.setSchedule("task_1", recurring);

    expect(putTaskScheduleMock).toHaveBeenCalledWith("task_1", recurring);
    expect(putTaskCalendarScheduleMock).not.toHaveBeenCalled();
  });
});

describe("taskScheduleService.mutateOccurrence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the precondition and target and returns the new revision", async () => {
    mutateTaskScheduleOccurrenceMock.mockResolvedValue({
      data: { scheduleRevision: 5, occurrence },
    });

    const target = new Date("2026-09-11T09:00:00.000Z");

    const result = await taskScheduleService.mutateOccurrence(
      "task_1",
      occurrence.id,
      {
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        expectedScheduleRevision: 4,
        action: "reschedule",
        scheduledAt: target,
      },
    );

    expect(mutateTaskScheduleOccurrenceMock).toHaveBeenCalledWith(
      "task_1",
      occurrence.id,
      {
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        expectedScheduleRevision: 4,
        action: "reschedule",
        scheduledAt: target,
      },
    );
    expect(result).toEqual({ scheduleRevision: 5, occurrence });
  });

  it.each([
    { action: "skip" as const },
    { action: "restore" as const },
    {
      action: "restore" as const,
      scheduledAt: new Date("2026-09-12T09:00:00.000Z"),
    },
  ])("forwards an $action mutation", async (mutation) => {
    mutateTaskScheduleOccurrenceMock.mockResolvedValue({
      data: { scheduleRevision: 5, occurrence },
    });

    await taskScheduleService.mutateOccurrence("task_1", occurrence.id, {
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      expectedScheduleRevision: 4,
      ...mutation,
    });

    expect(mutateTaskScheduleOccurrenceMock).toHaveBeenCalledWith(
      "task_1",
      occurrence.id,
      {
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        expectedScheduleRevision: 4,
        ...mutation,
      },
    );
  });
});
