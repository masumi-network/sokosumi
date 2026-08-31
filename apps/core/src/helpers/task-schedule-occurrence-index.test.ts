import { TaskScheduleQuarantineReason, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  refreshTaskSchedulePlannedOccurrences,
  replaceTaskSchedulePlannedOccurrences,
} from "./task-schedule-occurrence-index";

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";

describe("replaceTaskSchedulePlannedOccurrences", () => {
  it("rejects schedules that exceed the indexed occurrence limit", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      replaceTaskSchedulePlannedOccurrences(
        { taskScheduleOccurrence: { deleteMany, createMany } },
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

  it("replaces planned version 1 occurrences through the rolling horizon", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const now = new Date("2026-06-01T00:00:00.000Z");

    await replaceTaskSchedulePlannedOccurrences(
      {
        taskScheduleOccurrence: { deleteMany, createMany },
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

    expect(deleteMany).toHaveBeenCalledWith({
      where: { seriesTaskId: "tsk_v1", state: "PLANNED" },
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
    });
  });

  it("retains version 2 epoch identity", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
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
      { taskScheduleOccurrence: { deleteMany, createMany } },
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
    });
  });

  it("clears existing plans without failing when an existing schedule exceeds the limit", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(
      refreshTaskSchedulePlannedOccurrences(
        {
          taskScheduleOccurrence: { deleteMany, createMany },
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
        taskScheduleOccurrence: { deleteMany, createMany: vi.fn() },
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
        taskScheduleOccurrence: { deleteMany, createMany: vi.fn() },
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
