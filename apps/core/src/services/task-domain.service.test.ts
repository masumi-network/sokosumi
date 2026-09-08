import { TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import { createTaskForActor } from "./task-domain.service";

describe("createTaskForActor", () => {
  it("passes schedule audit fields to the nested creation event", async () => {
    const taskCreateMock = vi.fn().mockResolvedValue({ id: "task_123" });
    const tx = { task: { create: taskCreateMock } } as never;
    const nextRunAt = new Date("2099-09-24T09:00:00.000Z");
    const schedulePayload = {
      action: "create_schedule",
      source: { type: "workspace" },
      schedule: { mode: "once", runAt: nextRunAt.toISOString() },
    };

    await createTaskForActor(
      {
        actor: { kind: "user", userId: "user_123" },
        ownerId: "user_123",
        organizationId: null,
        workspaceId: "workspace_123",
        name: "Prepare release notes",
        status: TaskStatus.DRAFT,
        schedule: {
          metadata: {
            version: 2,
            epochId: "123e4567-e89b-42d3-a456-426614174001",
            mode: "once",
            createdAt: "2099-09-23T09:00:00.000Z",
            ruleEffectiveFrom: "2099-09-23T09:00:00.000Z",
            timezone: "UTC",
            sourceRunAt: nextRunAt.toISOString(),
            effectiveRunAt: nextRunAt.toISOString(),
          },
          nextRunAt,
          event: {
            scheduleKind: TaskScheduleEventKind.CREATED,
            scheduleOperationId: "123e4567-e89b-42d3-a456-426614174000",
            schedulePayload,
          },
        },
      },
      tx,
    );

    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        events: {
          create: expect.objectContaining({
            scheduleKind: TaskScheduleEventKind.CREATED,
            scheduleOperationId: "123e4567-e89b-42d3-a456-426614174000",
            schedulePayload,
          }),
        },
      }),
    });
  });
});
