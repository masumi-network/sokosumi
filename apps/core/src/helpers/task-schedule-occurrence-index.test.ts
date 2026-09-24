import { TaskScheduleQuarantineReason, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  countTaskScheduleFutureExceptions,
  createTaskSchedulePlannedOccurrences,
  findNextReleaseableOccurrence,
  refreshTaskSchedulePlannedOccurrences,
  replaceTaskSchedulePlannedOccurrences,
  retireTaskScheduleFutureOccurrences,
} from "./task-schedule-occurrence-index";

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";

describe("retireTaskScheduleFutureOccurrences", () => {
  const NOW = new Date("2026-06-10T00:00:00.000Z");

  function createRetireClient(
    rows: Array<{
      id: string;
      state: "PLANNED" | "SKIPPED";
      scheduleVersion: number;
      originalScheduledAt: Date | null;
      effectiveScheduledAt: Date;
    }>,
  ) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    return {
      client: {
        taskScheduleRun: { findMany, updateMany, deleteMany },
      },
      findMany,
      updateMany,
      deleteMany,
    };
  }

  it("only considers future planned and skipped rows, preserving released and past history", async () => {
    const { client, findMany } = createRetireClient([]);

    const result = await retireTaskScheduleFutureOccurrences(
      client,
      "tsk_series",
      NOW,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "tsk_series",
        effectiveScheduledAt: { gte: NOW },
        state: { in: ["PLANNED", "SKIPPED"] },
      },
      select: {
        id: true,
        state: true,
        scheduleVersion: true,
        originalScheduledAt: true,
        effectiveScheduledAt: true,
      },
    });
    expect(result).toEqual({ canceledCount: 0 });
  });

  it("cancels durable future exceptions and deletes only ordinary future projections", async () => {
    const { client, updateMany, deleteMany } = createRetireClient([
      {
        id: "occ_skipped",
        state: "SKIPPED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
      },
      {
        id: "occ_moved",
        state: "PLANNED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-12T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-13T15:00:00.000Z"),
      },
      {
        id: "occ_ordinary",
        state: "PLANNED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-14T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-14T09:00:00.000Z"),
      },
      {
        id: "occ_legacy",
        state: "PLANNED",
        scheduleVersion: 1,
        originalScheduledAt: null,
        effectiveScheduledAt: new Date("2026-06-15T09:00:00.000Z"),
      },
    ]);

    const result = await retireTaskScheduleFutureOccurrences(
      client,
      "tsk_series",
      NOW,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["occ_skipped", "occ_moved"] } },
      data: { state: "CANCELED" },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["occ_ordinary", "occ_legacy"] } },
    });
    expect(result).toEqual({ canceledCount: 2 });
  });

  it("deletes legacy version 1 rows the identity constraint forbids cancelling", async () => {
    const { client, updateMany, deleteMany } = createRetireClient([
      {
        id: "occ_v1_moved",
        state: "PLANNED",
        scheduleVersion: 1,
        originalScheduledAt: new Date("2026-06-12T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-13T15:00:00.000Z"),
      },
      {
        id: "occ_v1_skipped",
        state: "SKIPPED",
        scheduleVersion: 1,
        originalScheduledAt: new Date("2026-06-14T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-14T09:00:00.000Z"),
      },
    ]);

    const result = await retireTaskScheduleFutureOccurrences(
      client,
      "tsk_series",
      NOW,
    );

    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["occ_v1_moved", "occ_v1_skipped"] } },
    });
    expect(result).toEqual({ canceledCount: 0 });
  });

  it("writes nothing when the series has no future rows", async () => {
    const { client, updateMany, deleteMany } = createRetireClient([]);

    await retireTaskScheduleFutureOccurrences(client, "tsk_series", NOW);

    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("scopes a Project close retirement and includes the cutoff equality", async () => {
    const { client, findMany } = createRetireClient([]);

    await retireTaskScheduleFutureOccurrences(client, "tsk_series", NOW, {
      sourceProjectId: PROJECT_ID,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "tsk_series",
        sourceProjectId: PROJECT_ID,
        effectiveScheduledAt: { gte: NOW },
        state: { in: ["PLANNED", "SKIPPED"] },
      },
      select: expect.any(Object),
    });
  });
});

describe("countTaskScheduleFutureExceptions", () => {
  const NOW = new Date("2026-06-10T00:00:00.000Z");

  function createCountClient(
    rows: Array<{
      state: "PLANNED" | "SKIPPED";
      scheduleVersion: number;
      originalScheduledAt: Date | null;
      effectiveScheduledAt: Date;
    }>,
  ) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return {
      client: { taskScheduleRun: { findMany } },
      findMany,
    };
  }

  it("reads the same bounded future candidate set the retirement uses", async () => {
    const { client, findMany } = createCountClient([]);

    await expect(
      countTaskScheduleFutureExceptions(client, "tsk_series", NOW),
    ).resolves.toBe(0);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "tsk_series",
        effectiveScheduledAt: { gte: NOW },
        state: { in: ["PLANNED", "SKIPPED"] },
      },
      select: {
        state: true,
        scheduleVersion: true,
        originalScheduledAt: true,
        effectiveScheduledAt: true,
      },
    });
  });

  it("counts exactly the rows a full-series edit would cancel", async () => {
    const { client } = createCountClient([
      {
        state: "SKIPPED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
      },
      {
        state: "PLANNED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-12T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-13T15:00:00.000Z"),
      },
      {
        state: "PLANNED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-14T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-14T09:00:00.000Z"),
      },
      {
        state: "SKIPPED",
        scheduleVersion: 1,
        originalScheduledAt: new Date("2026-06-15T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-15T09:00:00.000Z"),
      },
    ]);

    await expect(
      countTaskScheduleFutureExceptions(client, "tsk_series", NOW),
    ).resolves.toBe(2);
  });
});

describe("createTaskSchedulePlannedOccurrences", () => {
  it("adds the projected rows without deleting existing ledger history", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });

    await createTaskSchedulePlannedOccurrences(
      { taskScheduleRun: { createMany } },
      {
        id: "tsk_v2",
        workspaceId: WORKSPACE_ID,
        projectId: null,
        schedule: {
          version: 2,
          epochId: "33333333-3333-7333-8333-333333333333",
          mode: "once",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          sourceRunAt: "2026-06-03T09:00:00.000Z",
          effectiveRunAt: "2026-06-03T09:00:00.000Z",
        },
        nextRunAt: new Date("2026-06-03T09:00:00.000Z"),
      },
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          seriesTaskId: "tsk_v2",
          epochId: "33333333-3333-7333-8333-333333333333",
          state: "PLANNED",
          scheduleVersion: 2,
        }),
      ],
    });
  });

  it("rejects schedules that exceed the indexed occurrence limit before writing", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      createTaskSchedulePlannedOccurrences(
        { taskScheduleRun: { createMany } },
        {
          id: "tsk_dense",
          workspaceId: WORKSPACE_ID,
          projectId: null,
          schedule: {
            version: 1,
            mode: "recurring",
            scheduledAt: "2026-06-01T00:00:00.000Z",
            expr: "* * * * *",
            timezone: "UTC",
            endsMode: "never",
          },
          nextRunAt: new Date("2026-06-01T00:01:00.000Z"),
        },
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("too many occurrences");

    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("replaceTaskSchedulePlannedOccurrences finite release capacity", () => {
  it("projects a replacement without increasing the persisted release target", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { originalScheduledAt: new Date("2026-06-02T09:00:00.000Z") },
      ])
      .mockResolvedValueOnce([]);
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const schedule = {
      version: 2 as const,
      epochId: "33333333-3333-7333-8333-333333333333",
      mode: "recurring" as const,
      createdAt: "2026-06-01T08:00:00.000Z",
      ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "after" as const,
      targetReleaseCount: 3,
      anchorAt: "2026-06-01T08:00:00.000Z",
      epochReleaseCount: 0,
    };
    const now = new Date("2026-06-01T08:30:00.000Z");

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany,
          createMany,
          deleteMany,
          updateMany,
        },
      },
      {
        id: "tsk_v2",
        workspaceId: WORKSPACE_ID,
        projectId: null,
        schedule,
        nextRunAt: new Date("2026-06-01T09:00:00.000Z"),
      },
      now,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "tsk_v2",
        epochId: schedule.epochId,
        state: "SKIPPED",
        originalScheduledAt: {
          gt: new Date("2026-06-01T08:00:00.000Z"),
        },
      },
      select: { originalScheduledAt: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          originalScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
          ruleSnapshot: schedule,
        }),
      ]),
      skipDuplicates: true,
    });
    expect(createMany.mock.calls[0][0].data).toHaveLength(4);
  });

  it("keeps replacement capacity for skipped rows that remain after a restore", async () => {
    const schedule = {
      version: 2 as const,
      epochId: "33333333-3333-7333-8333-333333333333",
      mode: "recurring" as const,
      createdAt: "2026-06-01T08:00:00.000Z",
      ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "after" as const,
      targetReleaseCount: 3,
      anchorAt: "2026-06-01T08:00:00.000Z",
      epochReleaseCount: 0,
    };
    const now = new Date("2026-06-01T08:30:00.000Z");
    const plannedRow = (day: number) => ({
      id: `occ_${day}`,
      epochId: schedule.epochId,
      state: "PLANNED" as const,
      scheduleVersion: 2,
      originalScheduledAt: new Date(`2026-06-0${day}T09:00:00.000Z`),
      effectiveScheduledAt: new Date(`2026-06-0${day}T09:00:00.000Z`),
      sourceWorkspaceId: WORKSPACE_ID,
      sourceType: "WORKSPACE" as const,
      sourceProjectId: null,
      sourceAccuracy: "EXACT" as const,
      timeAccuracy: "EXACT" as const,
    });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { originalScheduledAt: new Date("2026-06-02T09:00:00.000Z") },
      ])
      .mockResolvedValueOnce([
        plannedRow(1),
        plannedRow(3),
        plannedRow(4),
        plannedRow(5),
      ]);
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany,
          createMany,
          deleteMany,
          updateMany,
        },
      },
      {
        id: "tsk_v2",
        workspaceId: WORKSPACE_ID,
        projectId: null,
        schedule,
        nextRunAt: new Date("2026-06-01T09:00:00.000Z"),
      },
      now,
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["occ_5"] } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
          ruleSnapshot: schedule,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("projects remaining releases after a skipped occurrence becomes overdue", async () => {
    const schedule = {
      version: 2 as const,
      epochId: "33333333-3333-7333-8333-333333333333",
      mode: "recurring" as const,
      createdAt: "2026-06-01T08:00:00.000Z",
      ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "after" as const,
      targetReleaseCount: 3,
      anchorAt: "2026-06-01T08:00:00.000Z",
      epochReleaseCount: 1,
      lastProcessedSourceAt: "2026-06-01T09:00:00.000Z",
    };
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { originalScheduledAt: new Date("2026-06-02T09:00:00.000Z") },
      ])
      .mockResolvedValueOnce([]);
    const createMany = vi.fn().mockResolvedValue({ count: 2 });

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany,
          createMany,
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
      {
        id: "tsk_v2",
        workspaceId: WORKSPACE_ID,
        projectId: null,
        schedule,
        nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
      },
      new Date("2026-06-02T12:00:00.000Z"),
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
          ruleSnapshot: schedule,
        }),
        expect.objectContaining({
          originalScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
          ruleSnapshot: schedule,
        }),
      ],
      skipDuplicates: true,
    });
  });
});

describe("replaceTaskSchedulePlannedOccurrences", () => {
  it("rejects schedules that exceed the indexed occurrence limit", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      replaceTaskSchedulePlannedOccurrences(
        {
          taskScheduleRun: {
            findMany: vi.fn(),
            deleteMany,
            createMany,
            updateMany: vi.fn(),
          },
        },
        {
          id: "tsk_dense",
          workspaceId: WORKSPACE_ID,
          projectId: null,
          schedule: {
            version: 1,
            mode: "recurring",
            scheduledAt: "2026-06-01T00:00:00.000Z",
            expr: "* * * * *",
            timezone: "UTC",
            endsMode: "never",
          },
          nextRunAt: new Date("2026-06-01T00:01:00.000Z"),
        },
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("too many occurrences");

    expect(createMany).not.toHaveBeenCalled();
  });

  it("replaces future ordinary projections without selecting overdue work", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "occ_ordinary_future",
        epochId: null,
        state: "PLANNED",
        scheduleVersion: 1,
        originalScheduledAt: null,
        effectiveScheduledAt: new Date("2026-06-01T09:00:00.000Z"),
      },
      {
        id: "occ_moved_v2",
        epochId: "22222222-2222-7222-8222-222222222222",
        state: "PLANNED",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-02T15:00:00.000Z"),
      },
    ]);
    const now = new Date("2026-06-01T00:00:00.000Z");

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany,
          deleteMany,
          createMany,
          updateMany,
        },
      },
      {
        id: "tsk_v1",
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        schedule: {
          version: 1,
          mode: "recurring",
          scheduledAt: "2026-05-31T09:00:00.000Z",
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "after",
          occurrences: 3,
        },
        nextRunAt: new Date("2026-06-01T09:00:00.000Z"),
      },
      now,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          effectiveScheduledAt: { gte: now },
        }),
      }),
    );
    // The moved v2 row is a durable decision and is not deleted or rebuilt;
    // overdue ordinary rows are excluded by the query and remain releaseable.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["occ_ordinary_future"] } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          seriesTaskId: "tsk_v1",
          epochId: null,
          originalScheduledAt: new Date("2026-06-01T09:00:00.000Z"),
          effectiveScheduledAt: new Date("2026-06-01T09:00:00.000Z"),
          state: "PLANNED",
          scheduleVersion: 1,
          sourceWorkspaceId: WORKSPACE_ID,
          sourceType: "PROJECT",
          sourceProjectId: PROJECT_ID,
          sourceAccuracy: "EXACT",
          timeAccuracy: "EXACT",
          timezone: "UTC",
        }),
        expect.objectContaining({
          effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        }),
        expect.objectContaining({
          effectiveScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("preserves the id and refreshes the source of an unchanged projected occurrence", async () => {
    const epochId = "33333333-3333-7333-8333-333333333333";
    const originalScheduledAt = new Date("2026-06-01T09:00:00.000Z");
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "00000000-0000-7000-8000-000000000001",
          epochId,
          state: "PLANNED",
          scheduleVersion: 2,
          originalScheduledAt,
          effectiveScheduledAt: originalScheduledAt,
          sourceWorkspaceId: WORKSPACE_ID,
          sourceType: "PROJECT",
          sourceProjectId: "00000000-0000-7000-8000-000000000099",
        },
      ]);

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany,
          deleteMany,
          createMany,
          updateMany,
        },
      },
      {
        id: "tsk_v2",
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        schedule: {
          version: 2,
          epochId,
          mode: "recurring",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "after",
          targetReleaseCount: 2,
          anchorAt: "2026-06-01T08:00:00.000Z",
          epochReleaseCount: 0,
        },
        nextRunAt: originalScheduledAt,
      },
      new Date("2026-06-01T08:30:00.000Z"),
    );

    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["00000000-0000-7000-8000-000000000001"] } },
      data: {
        sourceWorkspaceId: WORKSPACE_ID,
        sourceType: "PROJECT",
        sourceProjectId: PROJECT_ID,
        sourceAccuracy: "EXACT",
        timeAccuracy: "EXACT",
      },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          epochId,
          originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
          effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("retains version 2 epoch identity", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([]);
    const task = {
      id: "tsk_v2",
      workspaceId: WORKSPACE_ID,
      projectId: null,
      schedule: {
        version: 2 as const,
        epochId: "33333333-3333-7333-8333-333333333333",
        mode: "once" as const,
        createdAt: "2026-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: "2026-06-03T09:00:00.000Z",
        effectiveRunAt: "2026-06-03T10:00:00.000Z",
      },
      nextRunAt: new Date("2026-06-03T10:00:00.000Z"),
    };

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany,
          deleteMany,
          createMany,
          updateMany,
        },
      },
      task,
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          epochId: "33333333-3333-7333-8333-333333333333",
          originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
          effectiveScheduledAt: new Date("2026-06-03T10:00:00.000Z"),
          scheduleVersion: 2,
          sourceType: "WORKSPACE",
          sourceProjectId: null,
          timezone: "UTC",
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("clears existing plans without failing when an existing schedule exceeds the limit", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      refreshTaskSchedulePlannedOccurrences(
        {
          taskScheduleRun: {
            findMany: vi.fn(),
            deleteMany,
            createMany,
            updateMany: vi.fn(),
          },
          taskScheduleQuarantine: { upsert: vi.fn() },
        },
        {
          id: "tsk_dense",
          workspaceId: WORKSPACE_ID,
          projectId: null,
          status: TaskStatus.QUEUED,
          metadata: JSON.stringify({
            version: 1,
            mode: "recurring",
            scheduledAt: "2026-06-01T00:00:00.000Z",
            expr: "* * * * *",
            timezone: "UTC",
            endsMode: "never",
          }),
          nextRunAt: new Date("2026-06-01T00:01:00.000Z"),
        },
      ),
    ).resolves.toBeUndefined();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
  }, 10_000);

  it("quarantines invalid schedules before clearing planned occurrences", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});

    await refreshTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany: vi.fn(),
          deleteMany,
          createMany: vi.fn(),
          updateMany: vi.fn(),
        },
        taskScheduleQuarantine: { upsert },
      },
      {
        id: "tsk_invalid",
        workspaceId: WORKSPACE_ID,
        projectId: null,
        status: TaskStatus.QUEUED,
        metadata: "{invalid",
        nextRunAt: new Date("2026-06-01T09:00:00.000Z"),
      },
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { taskId: "tsk_invalid" },
      create: expect.objectContaining({
        taskId: "tsk_invalid",
        reason: TaskScheduleQuarantineReason.INVALID_METADATA,
      }),
      update: expect.objectContaining({
        reason: TaskScheduleQuarantineReason.INVALID_METADATA,
      }),
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { seriesTaskId: "tsk_invalid", state: "PLANNED" },
    });
  });

  it("clears stale plans without quarantining unscheduled tasks", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});

    await refreshTaskSchedulePlannedOccurrences(
      {
        taskScheduleRun: {
          findMany: vi.fn(),
          deleteMany,
          createMany: vi.fn(),
          updateMany: vi.fn(),
        },
        taskScheduleQuarantine: { upsert },
      },
      {
        id: "tsk_unscheduled",
        workspaceId: WORKSPACE_ID,
        projectId: null,
        status: TaskStatus.QUEUED,
        metadata: null,
        nextRunAt: null,
      },
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { seriesTaskId: "tsk_unscheduled", state: "PLANNED" },
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("findNextReleaseableOccurrence", () => {
  it("returns the earliest planned row, including overdue work", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "occ_1",
      epochId: "33333333-3333-7333-8333-333333333333",
      originalScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
      effectiveScheduledAt: new Date("2026-06-11T15:00:00.000Z"),
    });

    await expect(
      findNextReleaseableOccurrence(
        { taskScheduleRun: { findFirst } },
        "tsk_series",
        "33333333-3333-7333-8333-333333333333",
      ),
    ).resolves.toEqual({
      id: "occ_1",
      epochId: "33333333-3333-7333-8333-333333333333",
      originalScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
      effectiveScheduledAt: new Date("2026-06-11T15:00:00.000Z"),
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "tsk_series",
        epochId: "33333333-3333-7333-8333-333333333333",
        state: "PLANNED",
      },
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        epochId: true,
        originalScheduledAt: true,
        effectiveScheduledAt: true,
      },
    });
  });

  it("returns null when no planned row remains", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);

    await expect(
      findNextReleaseableOccurrence(
        { taskScheduleRun: { findFirst } },
        "tsk_series",
        null,
      ),
    ).resolves.toBeNull();
  });
});
