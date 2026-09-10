import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/clients/generated/core";
import { TaskLinkRelation, TaskStatus } from "@/lib/clients/generated/core";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler({
        ...params,
        session: {
          session: {
            activeOrganizationId: "org-1",
          },
          user: {
            id: "user-1",
          },
        },
      }),
}));

const taskServiceMock = {
  createScheduledTask: vi.fn(),
  listTaskLinks: vi.fn(),
  deleteTaskLink: vi.fn(),
  createTaskLink: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  patchTask: vi.fn(),
  createTaskEvent: vi.fn(),
  getTaskById: vi.fn(),
};
const taskScheduleServiceMock = {
  removeCalendarSeries: vi.fn(),
  editCalendarSeries: vi.fn(),
  setSchedule: vi.fn(),
};
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const toCoreApiActionErrorMock = vi.fn();

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: toCoreApiActionErrorMock,
  CoreApiRequestError: class CoreApiRequestError extends Error {
    details?: unknown;
    kind?: string;
    status?: number;

    constructor(
      message: string,
      options?: { details?: unknown; kind?: string; status?: number },
    ) {
      super(message);
      this.name = "CoreApiRequestError";
      this.details = options?.details;
      this.kind = options?.kind;
      this.status = options?.status;
    }
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: taskServiceMock,
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: taskScheduleServiceMock,
}));

function buildTaskLink(
  overrides?: Partial<{
    id: string;
    relation: "child";
    note: null;
    peerTask: {
      id: string;
      name: string;
      status: TaskStatus;
      archivedAt: null;
    };
  }>,
) {
  return {
    id: "link-1",
    relation: "child" as const,
    note: null,
    peerTask: {
      id: "task-parent-old",
      name: "Old parent",
      status: TaskStatus.READY,
      archivedAt: null,
    },
    ...overrides,
  };
}

function buildTask(
  overrides?: Partial<
    Pick<
      Task,
      "id" | "name" | "description" | "assigneeId" | "projectId" | "status"
    > & {
      metadata: string | null;
      nextRunAt: Date | null;
    }
  >,
): Task {
  return {
    id: "task-created",
    name: "Generated task name",
    description: "Created related task",
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    status: TaskStatus.READY,
    ...overrides,
  } as Task;
}

describe("task link actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.listTaskLinks.mockReset();
    taskServiceMock.deleteTaskLink.mockReset();
    taskServiceMock.createTaskLink.mockReset();
    taskServiceMock.createTask.mockReset();
    taskServiceMock.deleteTask.mockReset();
    taskServiceMock.patchTask.mockReset();
    taskServiceMock.createTaskEvent.mockReset();
    taskServiceMock.getTaskById.mockReset();
    taskScheduleServiceMock.removeCalendarSeries.mockReset();
    taskScheduleServiceMock.editCalendarSeries.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
    taskServiceMock.patchTask.mockResolvedValue({});
    taskServiceMock.createTaskEvent.mockResolvedValue({});
    toCoreApiActionErrorMock.mockReset();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      message:
        error instanceof Error
          ? error.message
          : "Failed to communicate with Core API",
    }));
  });

  it("creates the new parent link before deleting previous parent links", async () => {
    taskServiceMock.listTaskLinks.mockResolvedValue([
      buildTaskLink(),
      buildTaskLink({
        id: "link-same-parent",
        peerTask: {
          id: "task-parent-new",
          name: "New parent",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      }),
    ]);
    taskServiceMock.createTaskLink.mockResolvedValue({
      id: "link-new",
      peerTask: {
        id: "task-parent-new",
      },
    });

    const { createTaskLink } = await import("./action");
    const result = await createTaskLink({
      taskId: "task-1",
      relatedTaskId: "task-parent-new",
      relation: TaskLinkRelation.CHILD,
    });

    expect(taskServiceMock.createTaskLink).toHaveBeenCalledWith("task-1", {
      toTaskId: "task-parent-new",
      relation: "child",
      note: undefined,
    });
    expect(taskServiceMock.deleteTaskLink).toHaveBeenCalledTimes(1);
    expect(taskServiceMock.deleteTaskLink).toHaveBeenCalledWith(
      "task-1",
      "link-1",
    );
    expect(
      taskServiceMock.createTaskLink.mock.invocationCallOrder[0],
    ).toBeLessThan(taskServiceMock.deleteTaskLink.mock.invocationCallOrder[0]);
    expect(result).toEqual({
      taskId: "task-1",
      relatedTaskId: "task-parent-new",
      linkId: "link-new",
    });
  });

  it("maps project context selection into the Core task payload", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("./action");

    await createTask({
      description: "Created related task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      context: {
        brand: { enabled: true, source: "project", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
    });

    expect(taskServiceMock.createTask).toHaveBeenCalledWith({
      description: "Created related task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      context: {
        brand: true,
        brandSource: "project",
        briefing: true,
        memory: true,
      },
      status: TaskStatus.READY,
    });
    expect(taskServiceMock.createTask.mock.calls[0][0]).not.toHaveProperty(
      "name",
    );
  });

  it("maps workspace brand and project-file opt-outs", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("./action");

    await createTask({
      description: "Created related task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      context: {
        brand: { enabled: true, source: "default", custom: null },
        briefingEnabled: false,
        contextMdEnabled: false,
      },
      status: TaskStatus.READY,
    });

    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
        context: {
          brand: true,
          brandSource: "workspace",
          briefing: false,
          memory: false,
        },
      }),
    );
  });

  it("maps disabled brand without a brand source", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("./action");

    await createTask({
      description: "Created related task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      context: {
        brand: { enabled: false, source: "project", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
    });

    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
        context: {
          brand: false,
          briefing: true,
          memory: true,
        },
      }),
    );
  });

  it("maps an ad hoc DESIGN.md URL into custom Core brand context", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("./action");
    const overrideUrl =
      "https://blob.example/design-md/adhoc/user-1/42-hash.md";

    await createTask({
      description: "Created related task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      context: {
        brand: {
          enabled: true,
          source: "custom",
          custom: { url: overrideUrl },
        },
        briefingEnabled: true,
        contextMdEnabled: false,
      },
      status: TaskStatus.READY,
    });

    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
        context: {
          brand: { url: overrideUrl },
          briefing: true,
          memory: false,
        },
      }),
    );
  });

  it("rejects non-adhoc or non-https custom brand URLs", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("./action");

    await expect(
      createTask({
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        context: {
          brand: { enabled: true, source: "custom", custom: null },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
        status: TaskStatus.READY,
      }),
    ).rejects.toThrow("Custom DESIGN.md attachment required");

    await expect(
      createTask({
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        context: {
          brand: {
            enabled: true,
            source: "custom",
            custom: {
              url: "http://blob.example/design-md/adhoc/user-1/42-hash.md",
            },
          },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
        status: TaskStatus.READY,
      }),
    ).rejects.toThrow("DESIGN.md attachment URL must use https");

    await expect(
      createTask({
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        context: {
          brand: {
            enabled: true,
            source: "custom",
            custom: {
              url: "https://blob.example/design-md/adhoc/other-user/42-hash.md",
            },
          },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
        status: TaskStatus.READY,
      }),
    ).rejects.toThrow("DESIGN.md attachment URL is not valid for this user");

    await expect(
      createTask({
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        context: {
          brand: {
            enabled: true,
            source: "custom",
            custom: { url: "https://evil.example/not-design.md" },
          },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
        status: TaskStatus.READY,
      }),
    ).rejects.toThrow("DESIGN.md attachment URL is not valid for this user");
  });

  it("rethrows Core 404 Project not found from createTask (SOKOSUMI-QA)", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    const { createTask } = await import("./action");

    const projectMissing = new CoreApiRequestError("Project not found", {
      status: 404,
    });
    taskServiceMock.createTask.mockRejectedValue(projectMissing);

    await expect(
      createTask({
        description: "Task with stale project",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        status: TaskStatus.READY,
      }),
    ).rejects.toMatchObject({
      name: "CoreApiRequestError",
      message: "Project not found",
      status: 404,
    });
  });

  it("keeps the existing parent when creating the new link fails", async () => {
    taskServiceMock.listTaskLinks.mockResolvedValue([buildTaskLink()]);
    taskServiceMock.createTaskLink.mockRejectedValue(new Error("link failed"));

    const { createTaskLink } = await import("./action");

    await expect(
      createTaskLink({
        taskId: "task-1",
        relatedTaskId: "task-parent-new",
        relation: TaskLinkRelation.CHILD,
      }),
    ).rejects.toThrow("link failed");

    expect(taskServiceMock.deleteTaskLink).not.toHaveBeenCalled();
  });

  it("rolls back the new parent link and restores deleted parents when cleanup fails", async () => {
    taskServiceMock.listTaskLinks.mockResolvedValue([
      buildTaskLink({
        id: "link-old-1",
        peerTask: {
          id: "task-parent-old-1",
          name: "Old parent 1",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      }),
      buildTaskLink({
        id: "link-old-2",
        peerTask: {
          id: "task-parent-old-2",
          name: "Old parent 2",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      }),
    ]);
    taskServiceMock.createTaskLink
      .mockResolvedValueOnce({
        id: "link-new",
        peerTask: {
          id: "task-parent-new",
        },
      })
      .mockResolvedValueOnce({
        id: "link-restored",
        peerTask: {
          id: "task-parent-old-1",
        },
      });
    taskServiceMock.deleteTaskLink
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockResolvedValueOnce({ deleted: true });

    const { createTaskLink } = await import("./action");

    await expect(
      createTaskLink({
        taskId: "task-1",
        relatedTaskId: "task-parent-new",
        relation: TaskLinkRelation.CHILD,
      }),
    ).rejects.toThrow("cleanup failed");

    expect(taskServiceMock.deleteTaskLink).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "link-old-1",
    );
    expect(taskServiceMock.deleteTaskLink).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "link-old-2",
    );
    expect(taskServiceMock.deleteTaskLink).toHaveBeenNthCalledWith(
      3,
      "task-1",
      "link-new",
    );
    expect(taskServiceMock.createTaskLink).toHaveBeenNthCalledWith(
      2,
      "task-1",
      {
        toTaskId: "task-parent-old-1",
        relation: "child",
        note: null,
      },
    );
  });

  it("throws when parent replacement rollback fails after cleanup errors", async () => {
    taskServiceMock.listTaskLinks.mockResolvedValue([buildTaskLink()]);
    taskServiceMock.createTaskLink.mockResolvedValue({
      id: "link-new",
      peerTask: {
        id: "task-parent-new",
      },
    });
    taskServiceMock.deleteTaskLink
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockRejectedValueOnce(new Error("rollback delete failed"));

    const { createTaskLink } = await import("./action");

    await expect(
      createTaskLink({
        taskId: "task-1",
        relatedTaskId: "task-parent-new",
        relation: TaskLinkRelation.CHILD,
      }),
    ).rejects.toThrow(
      new RegExp(
        "inconsistent after a failed parent replacement[\\s\\S]*rollback delete failed[\\s\\S]*while recovering from: cleanup failed",
      ),
    );
  });

  it("archives the created task when creating the link fails after task creation", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());
    taskServiceMock.listTaskLinks.mockResolvedValue([]);
    taskServiceMock.createTaskLink.mockRejectedValue(new Error("link failed"));

    const { createTaskAndLink } = await import("./action");

    await expect(
      createTaskAndLink({
        taskId: "task-1",
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
        relation: TaskLinkRelation.CHILD,
      }),
    ).rejects.toThrow("link failed");

    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
      }),
    );
    expect(taskServiceMock.createTask.mock.calls[0][0]).not.toHaveProperty(
      "name",
    );
    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("task-created");
  });

  it("archives the created task after rolling back a failed parent cleanup", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());
    taskServiceMock.listTaskLinks.mockResolvedValue([
      buildTaskLink({
        id: "link-old-1",
      }),
      buildTaskLink({
        id: "link-old-2",
        peerTask: {
          id: "task-parent-old-2",
          name: "Old parent 2",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      }),
    ]);
    taskServiceMock.createTaskLink
      .mockResolvedValueOnce({
        id: "link-created",
        peerTask: {
          id: "task-created",
        },
      })
      .mockResolvedValueOnce({
        id: "link-restored",
        peerTask: {
          id: "task-parent-old",
        },
      });
    taskServiceMock.deleteTaskLink
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockResolvedValueOnce({ deleted: true });

    const { createTaskAndLink } = await import("./action");

    await expect(
      createTaskAndLink({
        taskId: "task-1",
        description: "Created related task",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
        relation: TaskLinkRelation.CHILD,
      }),
    ).rejects.toThrow("cleanup failed");

    expect(taskServiceMock.deleteTaskLink).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "link-old-1",
    );
    expect(taskServiceMock.deleteTaskLink).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "link-old-2",
    );
    expect(taskServiceMock.deleteTaskLink).toHaveBeenNthCalledWith(
      3,
      "task-1",
      "link-created",
    );
    expect(taskServiceMock.createTaskLink).toHaveBeenNthCalledWith(
      2,
      "task-1",
      {
        toTaskId: "task-parent-old",
        relation: "child",
        note: null,
      },
    );
    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("task-created");
  });

  it("returns a client-upgrade result when related-task scheduling is gated", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskScheduleServiceMock.setSchedule.mockRejectedValue(
      new CoreApiRequestError("Reload required", {
        status: 426,
        kind: "calendar_client_upgrade_required",
      }),
    );
    const { createTaskAndLink } = await import("./action");

    const result = await createTaskAndLink({
      taskId: "task-1",
      description: "Related scheduled task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.READY,
      schedule: {
        mode: "recurring",
        timezone: "UTC",
        cron: "0 9 * * *",
      },
      relation: TaskLinkRelation.RELATED,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });
    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("task-created");
    expect(taskServiceMock.createTaskLink).not.toHaveBeenCalled();
  });
});

describe("updateTask schedule status", () => {
  const recurringSchedule = {
    mode: "recurring" as const,
    timezone: "UTC",
    cron: "0 9 * * *",
    oneTimeLocalIso: "2026-06-25T09:00",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.patchTask.mockResolvedValue({});
    taskServiceMock.createTaskEvent.mockResolvedValue({});
    taskScheduleServiceMock.removeCalendarSeries.mockReset();
    taskScheduleServiceMock.editCalendarSeries.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
  });

  it("does not re-queue after removing the series on a queued task", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      scheduleRevision: 5,
    });
    taskScheduleServiceMock.removeCalendarSeries.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
      scheduleRevision: 6,
    });

    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: true,
      expectedScheduleRevision: 4,
      scheduleOperationId: OPERATION_ID,
      originalSchedule: recurringSchedule,
      schedule: { mode: "none", timezone: "UTC" },
    });

    expect(taskScheduleServiceMock.removeCalendarSeries).toHaveBeenCalledWith(
      "task-1",
      { operationId: OPERATION_ID, expectedScheduleRevision: 4 },
    );
    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-1",
      expect.not.objectContaining({
        expectedScheduleRevision: expect.anything(),
      }),
    );
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("changes the series first and patches fields with the returned revision", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      scheduleRevision: 6,
    });
    taskScheduleServiceMock.editCalendarSeries.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.QUEUED,
      scheduleRevision: 5,
    });

    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Renamed task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: true,
      expectedScheduleRevision: 4,
      scheduleOperationId: OPERATION_ID,
      originalSchedule: recurringSchedule,
      schedule: { ...recurringSchedule, cron: "0 10 * * *" },
    });

    expect(taskScheduleServiceMock.editCalendarSeries).toHaveBeenCalledWith(
      "task-1",
      { operationId: OPERATION_ID, expectedScheduleRevision: 4 },
      expect.objectContaining({ expr: "0 10 * * *" }),
    );
    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        name: "Renamed task",
        expectedScheduleRevision: 5,
      }),
    );
    expect(
      taskScheduleServiceMock.editCalendarSeries.mock.invocationCallOrder[0],
    ).toBeLessThan(taskServiceMock.patchTask.mock.invocationCallOrder[0] ?? 0);
    expect(taskScheduleServiceMock.setSchedule).not.toHaveBeenCalled();
  });

  it("replays a lost field-patch response without repeating the patch", async () => {
    const input = {
      taskId: "task-1",
      name: "Renamed task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: true,
      expectedScheduleRevision: 4,
      scheduleOperationId: OPERATION_ID,
      originalSchedule: recurringSchedule,
      schedule: { ...recurringSchedule, cron: "0 10 * * *" },
    };
    taskScheduleServiceMock.editCalendarSeries
      .mockResolvedValueOnce({
        id: "task-1",
        name: "Task",
        description: "Do work",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        status: TaskStatus.QUEUED,
        scheduleRevision: 5,
      })
      .mockResolvedValueOnce({
        id: "task-1",
        name: "Renamed task",
        description: "Do work",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        status: TaskStatus.QUEUED,
        scheduleRevision: 6,
      });
    taskServiceMock.patchTask.mockRejectedValueOnce(
      new Error("response lost after commit"),
    );

    const { updateTask } = await import("./action");

    await expect(updateTask(input)).rejects.toThrow(
      "response lost after commit",
    );
    await expect(updateTask(input)).resolves.toEqual({
      ok: true,
      value: { taskId: "task-1" },
    });

    expect(taskScheduleServiceMock.editCalendarSeries).toHaveBeenCalledTimes(2);
    expect(taskServiceMock.patchTask).toHaveBeenCalledTimes(1);
  });

  it("refuses to invent a revision when Core reports none for a live series", async () => {
    taskServiceMock.patchTask.mockResolvedValue({ id: "task-1" });

    const { updateTask } = await import("./action");

    await expect(
      updateTask({
        taskId: "task-1",
        name: "Renamed task",
        description: "Do work",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        currentStatus: TaskStatus.QUEUED,
        desiredStatus: TaskStatus.QUEUED,
        hadSchedule: true,
        scheduleOperationId: OPERATION_ID,
        originalSchedule: recurringSchedule,
        schedule: { ...recurringSchedule, cron: "0 10 * * *" },
      }),
    ).rejects.toThrow();

    expect(taskScheduleServiceMock.editCalendarSeries).not.toHaveBeenCalled();
    expect(taskServiceMock.patchTask).not.toHaveBeenCalled();
  });

  it("maps a stale revision to an actionable conflict result instead of throwing", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskServiceMock.patchTask.mockRejectedValue(
      new CoreApiRequestError("The schedule series changed", {
        status: 409,
        kind: "schedule_revision_conflict",
      }),
    );

    const { updateTask } = await import("./action");

    const result = await updateTask({
      taskId: "task-1",
      name: "Renamed task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: true,
      expectedScheduleRevision: 4,
      scheduleOperationId: OPERATION_ID,
      originalSchedule: recurringSchedule,
      schedule: recurringSchedule,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "schedule_revision_conflict" },
    });
    expect(taskScheduleServiceMock.editCalendarSeries).not.toHaveBeenCalled();
  });

  it("reports a quarantined series as its own actionable kind", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      scheduleRevision: 5,
    });
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskScheduleServiceMock.editCalendarSeries.mockRejectedValue(
      new CoreApiRequestError("This schedule is quarantined", {
        status: 409,
        kind: "schedule_quarantined",
      }),
    );

    const { updateTask } = await import("./action");

    const result = await updateTask({
      taskId: "task-1",
      name: "Renamed task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: true,
      expectedScheduleRevision: 4,
      scheduleOperationId: OPERATION_ID,
      originalSchedule: recurringSchedule,
      schedule: { ...recurringSchedule, cron: "0 10 * * *" },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "schedule_quarantined" },
    });
    expect(taskServiceMock.patchTask).not.toHaveBeenCalled();
  });

  it("does not revert to draft after adding a schedule", async () => {
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.QUEUED,
    });

    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.DRAFT,
      desiredStatus: TaskStatus.DRAFT,
      hadSchedule: false,
      originalSchedule: { mode: "none", timezone: "UTC" },
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("does not force Queued when a human schedule lands Ready (save must succeed)", async () => {
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.READY,
    });

    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user-1",
      currentStatus: TaskStatus.READY,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: false,
      originalSchedule: { mode: "none", timezone: "UTC" },
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("emits Queued after schedule when an agent requested Queued but schedule left Ready", async () => {
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.READY,
    });

    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.READY,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: false,
      originalSchedule: { mode: "none", timezone: "UTC" },
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.QUEUED,
    });
  });

  it("applies an explicit draft/ready toggle when the schedule is unchanged", async () => {
    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.DRAFT,
      desiredStatus: TaskStatus.READY,
      hadSchedule: false,
      schedule: { mode: "none", timezone: "UTC" },
    });

    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("never removes an unchanged series just because the requested status differs", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      scheduleRevision: 5,
    });

    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.DRAFT,
      hadSchedule: true,
      expectedScheduleRevision: 4,
      scheduleOperationId: OPERATION_ID,
      originalSchedule: recurringSchedule,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
    expect(taskScheduleServiceMock.editCalendarSeries).not.toHaveBeenCalled();
  });
});

describe("setTaskStatusFromDrag", () => {
  const scheduledMetadata = JSON.stringify({
    schedule: { mode: "daily", timezone: "UTC" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.getTaskById.mockReset();
    taskServiceMock.createTaskEvent.mockReset();
    taskScheduleServiceMock.removeCalendarSeries.mockReset();
    taskServiceMock.createTaskEvent.mockResolvedValue({});
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      message:
        error instanceof Error
          ? error.message
          : "Failed to communicate with Core API",
    }));
  });

  it("creates a status event for a simple draft to ready move", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.DRAFT,
      }),
    );

    const { setTaskStatusFromDrag } = await import("./action");

    await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
    });

    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("includes a trimmed comment when reopening completed to ready", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.COMPLETED,
      }),
    );

    const { setTaskStatusFromDrag } = await import("./action");

    await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
      comment: "  Please revise the deliverable  ",
    });

    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
      comment: "Please revise the deliverable",
    });
  });

  it("rejects reopening completed to ready without a comment", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.COMPLETED,
      }),
    );

    const { setTaskStatusFromDrag } = await import("./action");

    await expect(
      setTaskStatusFromDrag({
        taskId: "task-1",
        desiredStatus: TaskStatus.READY,
      }),
    ).rejects.toThrow(/comment is required/i);
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("rejects a scheduled Task drag as schedule_active without touching its schedule or status", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.QUEUED,
        metadata: scheduledMetadata,
        nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
      }),
    );

    const { setTaskStatusFromDrag } = await import("./action");

    const result = await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
    });

    expect(result).toEqual({ ok: false, error: { kind: "schedule_active" } });
    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("rejects a scheduled Task dragged back to draft rather than silently unscheduling it", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.QUEUED,
        metadata: scheduledMetadata,
        nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
      }),
    );

    const { setTaskStatusFromDrag } = await import("./action");

    const result = await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.DRAFT,
    });

    expect(result).toEqual({ ok: false, error: { kind: "schedule_active" } });
    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("rejects moving a scheduled ready task to draft without clearing the series", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.READY,
        metadata: scheduledMetadata,
        nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
      }),
    );

    const { setTaskStatusFromDrag } = await import("./action");

    const result = await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.DRAFT,
    });

    expect(result).toEqual({ ok: false, error: { kind: "schedule_active" } });
    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("maps a Core client-upgrade rejection to its stable result kind", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({ id: "task-1", status: TaskStatus.DRAFT }),
    );
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskServiceMock.createTaskEvent.mockRejectedValue(
      new CoreApiRequestError("Reload required", {
        status: 426,
        kind: "calendar_client_upgrade_required",
      }),
    );
    const { setTaskStatusFromDrag } = await import("./action");

    const result = await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });
  });
});

describe("createTask schedule", () => {
  const recurringSchedule = {
    mode: "recurring" as const,
    timezone: "UTC",
    cron: "0 9 * * *",
    oneTimeLocalIso: "2026-06-25T09:00",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.createTask.mockReset();
    taskServiceMock.createTaskEvent.mockReset();
    taskServiceMock.deleteTask.mockReset();
    taskScheduleServiceMock.removeCalendarSeries.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
    taskServiceMock.createTaskEvent.mockResolvedValue({});
  });

  it("does not apply a schedule when saving as draft", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );

    const { createTask } = await import("./action");

    await createTask({
      description: "Draft task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.DRAFT,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).not.toHaveBeenCalled();
    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
  });

  it("applies a schedule when creating a ready task with a schedule", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-created",
      status: TaskStatus.QUEUED,
    });

    const { createTask } = await import("./action");

    await createTask({
      description: "Scheduled task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.READY,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
  });

  it("applies a schedule when creating a queued task with a schedule (SOK-1033)", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-created",
      status: TaskStatus.QUEUED,
    });

    const { createTask } = await import("./action");

    await createTask({
      description: "Queued scheduled task",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.QUEUED,
      schedule: recurringSchedule,
    });

    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.DRAFT }),
    );
    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("saves a human Queued+schedule create without forcing a Queued event", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-created",
      status: TaskStatus.READY,
    });

    const { createTask } = await import("./action");

    await createTask({
      description: "Human scheduled queued task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user-1",
      status: TaskStatus.QUEUED,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
    expect(taskServiceMock.deleteTask).not.toHaveBeenCalled();
  });

  it("emits Queued after create schedule when an agent requested Queued but schedule left Ready", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-created",
      status: TaskStatus.READY,
    });

    const { createTask } = await import("./action");

    await createTask({
      description: "Agent scheduled queued task",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.QUEUED,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith(
      "task-created",
      { status: TaskStatus.QUEUED },
    );
  });

  it("archives the created task when a post-schedule agent Queued event fails", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-created",
      status: TaskStatus.READY,
    });
    taskServiceMock.createTaskEvent.mockRejectedValue(
      new Error("A schedule is required before moving a task to Queued"),
    );

    const { createTask } = await import("./action");

    await expect(
      createTask({
        description: "Agent scheduled queued task",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.QUEUED,
        schedule: recurringSchedule,
      }),
    ).rejects.toThrow(/schedule is required|Failed to create/);

    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("task-created");
  });

  it("returns a client-upgrade outcome for the exact Calendar 426 error", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskScheduleServiceMock.setSchedule.mockRejectedValue(
      new CoreApiRequestError("Reload required", {
        status: 426,
        kind: "calendar_client_upgrade_required",
      }),
    );

    const { createTask } = await import("./action");
    const result = await createTask({
      description: "Scheduled task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.READY,
      schedule: recurringSchedule,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });
    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("task-created");
    expect(toCoreApiActionErrorMock).not.toHaveBeenCalled();
  });
});

describe("Calendar schedule actions", () => {
  const operationId = "123e4567-e89b-42d3-a456-426614174000";
  const recurringSchedule = {
    mode: "recurring" as const,
    timezone: "UTC",
    cron: "0 9 * * *",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.createScheduledTask.mockReset();
    taskScheduleServiceMock.removeCalendarSeries.mockReset();
    taskScheduleServiceMock.editCalendarSeries.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
  });

  it("creates a scheduled task with the caller operation and selected source", async () => {
    taskServiceMock.createScheduledTask.mockResolvedValue(
      buildTask({
        id: "task-scheduled",
        name: "Schedule launch",
        projectId: "project-1",
      }),
    );
    const { createScheduledTask } = await import("./action");

    const result = await createScheduledTask({
      operationId,
      source: {
        type: "project",
        projectId: "11111111-1111-4111-8111-111111111111",
      },
      description: "  Prepare the launch brief  ",
      assigneeId: "coworker-1",
      context: {
        brand: { enabled: true, source: "project", custom: null },
        briefingEnabled: true,
        contextMdEnabled: false,
      },
      schedule: recurringSchedule,
    });

    expect(taskServiceMock.createScheduledTask).toHaveBeenCalledWith({
      operationId,
      source: {
        type: "project",
        projectId: "11111111-1111-4111-8111-111111111111",
      },
      description: "Prepare the launch brief",
      context: {
        brand: true,
        brandSource: "project",
        briefing: true,
        memory: false,
      },
      assigneeId: "coworker-1",
      schedule: {
        mode: "recurring",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      },
    });
    expect(result).toEqual({
      ok: true,
      value: { taskId: "task-scheduled", name: "Schedule launch" },
    });
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/task-scheduled");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/calendar");
  });

  it("saves an active series with the caller operation and observed revision", async () => {
    taskScheduleServiceMock.editCalendarSeries.mockResolvedValue(
      buildTask({ id: "task-1", projectId: "project-1" }),
    );
    const { saveCalendarTaskSchedule } = await import("./action");

    const result = await saveCalendarTaskSchedule({
      taskId: "task-1",
      operationId,
      expectedScheduleRevision: 3,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.editCalendarSeries).toHaveBeenCalledWith(
      "task-1",
      { operationId, expectedScheduleRevision: 3 },
      {
        mode: "recurring",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      },
    );
    expect(taskScheduleServiceMock.setSchedule).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { taskId: "task-1" } });
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/task-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/calendar");
  });

  it("removes a series with its precondition and revalidates its Calendar routes", async () => {
    taskScheduleServiceMock.removeCalendarSeries.mockResolvedValue(
      buildTask({ id: "task-1", projectId: "project-1" }),
    );
    const { clearTaskSchedule } = await import("./action");

    const result = await clearTaskSchedule({
      taskId: "task-1",
      operationId,
      expectedScheduleRevision: 3,
    });

    expect(taskScheduleServiceMock.removeCalendarSeries).toHaveBeenCalledWith(
      "task-1",
      { operationId, expectedScheduleRevision: 3 },
    );
    expect(result).toEqual({ ok: true, value: { taskId: "task-1" } });
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/task-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/calendar");
  });

  it("maps a removal revision conflict to an actionable result", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskScheduleServiceMock.removeCalendarSeries.mockRejectedValue(
      new CoreApiRequestError("The schedule series changed", {
        status: 409,
        kind: "schedule_revision_conflict",
      }),
    );
    const { clearTaskSchedule } = await import("./action");

    await expect(
      clearTaskSchedule({
        taskId: "task-1",
        operationId,
        expectedScheduleRevision: 3,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "schedule_revision_conflict" },
    });
  });

  it("maps a reused operation with different semantics to idempotency_conflict", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskScheduleServiceMock.editCalendarSeries.mockRejectedValue(
      new CoreApiRequestError("Operation already used", {
        status: 409,
        kind: "idempotency_conflict",
      }),
    );
    const { saveCalendarTaskSchedule } = await import("./action");

    await expect(
      saveCalendarTaskSchedule({
        taskId: "task-1",
        operationId,
        expectedScheduleRevision: 3,
        schedule: recurringSchedule,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "idempotency_conflict" },
    });
  });

  it("requires a UUID operation identity before reaching Core", async () => {
    const { clearTaskSchedule, saveCalendarTaskSchedule } = await import(
      "./action"
    );

    await expect(
      saveCalendarTaskSchedule({
        taskId: "task-1",
        operationId: "not-a-uuid",
        expectedScheduleRevision: 3,
        schedule: recurringSchedule,
      }),
    ).rejects.toThrow("Operation ID must be a UUID");
    await expect(
      clearTaskSchedule({
        taskId: "task-1",
        operationId: "not-a-uuid",
        expectedScheduleRevision: 3,
      }),
    ).rejects.toThrow("Operation ID must be a UUID");
    expect(taskScheduleServiceMock.editCalendarSeries).not.toHaveBeenCalled();
    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
  });

  it("rejects inactive or malformed schedule selections before Core", async () => {
    const { createScheduledTask, saveCalendarTaskSchedule } = await import(
      "./action"
    );

    await expect(
      createScheduledTask({
        operationId,
        source: { type: "workspace" },
        description: "Scheduled task",
        assigneeId: "coworker-1",
        schedule: { mode: "none", timezone: "UTC" },
      }),
    ).rejects.toThrow("Active schedule required");
    await expect(
      saveCalendarTaskSchedule({
        taskId: "task-1",
        operationId,
        expectedScheduleRevision: 3,
        schedule: {
          mode: "recurring",
          timezone: "UTC",
          cron: "not a cron expression",
        },
      }),
    ).rejects.toThrow("Invalid schedule");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));
    await expect(
      saveCalendarTaskSchedule({
        taskId: "task-1",
        operationId,
        expectedScheduleRevision: 3,
        schedule: {
          mode: "once",
          timezone: "UTC",
          oneTimeLocalIso: "2026-06-24T11:59",
        },
      }),
    ).rejects.toThrow("Invalid schedule");
    expect(taskServiceMock.createScheduledTask).not.toHaveBeenCalled();
    expect(taskScheduleServiceMock.setSchedule).not.toHaveBeenCalled();
  });
});
