import { TaskLinkType, TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const appendDesignMdToDescriptionMock = vi.fn();
const taskServiceMock = {
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
  clearSchedule: vi.fn(),
  setSchedule: vi.fn(),
};
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: toCoreApiActionErrorMock,
}));

vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: {
    appendDesignMdToDescription: (...args: unknown[]) =>
      appendDesignMdToDescriptionMock(...args),
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
  overrides?: Partial<{ id: string; name: string; status: TaskStatus }>,
) {
  return {
    id: "task-created",
    name: "Generated task name",
    description: "Created related task",
    coworkerId: null,
    status: TaskStatus.READY,
    ...overrides,
  } as never;
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
    taskScheduleServiceMock.clearSchedule.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
    taskServiceMock.patchTask.mockResolvedValue({});
    taskServiceMock.createTaskEvent.mockResolvedValue({});
    appendDesignMdToDescriptionMock.mockReset();
    appendDesignMdToDescriptionMock.mockImplementation(
      async (description: string) => description,
    );
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

    const { createTaskLink } = await import("../action");
    const result = await createTaskLink({
      taskId: "task-1",
      relatedTaskId: "task-parent-new",
      type: TaskLinkType.PARENT,
      direction: "incoming",
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

  it("prepends the effective design.md attachment before creating a task", async () => {
    appendDesignMdToDescriptionMock.mockResolvedValue(
      "[DESIGN.md](https://blob.example/design.md)\n\nCreated related task",
    );
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("../action");

    await createTask({
      description: "Created related task",
      coworkerId: null,
      status: TaskStatus.READY,
    });

    expect(appendDesignMdToDescriptionMock).toHaveBeenCalledWith(
      "Created related task",
    );
    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "[DESIGN.md](https://blob.example/design.md)\n\nCreated related task",
      }),
    );
    expect(taskServiceMock.createTask.mock.calls[0][0]).not.toHaveProperty(
      "name",
    );
  });

  it("skips design.md attachment when the composer removed it", async () => {
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("../action");

    await createTask({
      description: "Created related task",
      coworkerId: null,
      skipDesignMdAttachment: true,
      status: TaskStatus.READY,
    });

    expect(appendDesignMdToDescriptionMock).not.toHaveBeenCalled();
    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
      }),
    );
    expect(taskServiceMock.createTask.mock.calls[0][0]).not.toHaveProperty(
      "name",
    );
  });

  it("keeps the existing parent when creating the new link fails", async () => {
    taskServiceMock.listTaskLinks.mockResolvedValue([buildTaskLink()]);
    taskServiceMock.createTaskLink.mockRejectedValue(new Error("link failed"));

    const { createTaskLink } = await import("../action");

    await expect(
      createTaskLink({
        taskId: "task-1",
        relatedTaskId: "task-parent-new",
        type: TaskLinkType.PARENT,
        direction: "incoming",
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

    const { createTaskLink } = await import("../action");

    await expect(
      createTaskLink({
        taskId: "task-1",
        relatedTaskId: "task-parent-new",
        type: TaskLinkType.PARENT,
        direction: "incoming",
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

    const { createTaskLink } = await import("../action");

    await expect(
      createTaskLink({
        taskId: "task-1",
        relatedTaskId: "task-parent-new",
        type: TaskLinkType.PARENT,
        direction: "incoming",
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

    const { createTaskAndLink } = await import("../action");

    await expect(
      createTaskAndLink({
        taskId: "task-1",
        description: "Created related task",
        coworkerId: null,
        status: TaskStatus.READY,
        type: TaskLinkType.PARENT,
        direction: "incoming",
      }),
    ).rejects.toThrow("link failed");

    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
        coworkerId: null,
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

    const { createTaskAndLink } = await import("../action");

    await expect(
      createTaskAndLink({
        taskId: "task-1",
        description: "Created related task",
        coworkerId: null,
        status: TaskStatus.READY,
        type: TaskLinkType.PARENT,
        direction: "incoming",
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
    taskScheduleServiceMock.clearSchedule.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
  });

  it("does not re-queue after clearing a schedule on a queued task", async () => {
    taskScheduleServiceMock.clearSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });

    const { updateTask } = await import("../action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      coworkerId: "coworker-1",
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.QUEUED,
      hadSchedule: true,
      originalSchedule: recurringSchedule,
      schedule: { mode: "none", timezone: "UTC" },
    });

    expect(taskScheduleServiceMock.clearSchedule).toHaveBeenCalledWith(
      "task-1",
    );
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("does not revert to draft after adding a schedule", async () => {
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.QUEUED,
    });

    const { updateTask } = await import("../action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      coworkerId: "coworker-1",
      currentStatus: TaskStatus.DRAFT,
      desiredStatus: TaskStatus.DRAFT,
      hadSchedule: false,
      originalSchedule: { mode: "none", timezone: "UTC" },
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("applies an explicit draft/ready toggle when the schedule is unchanged", async () => {
    const { updateTask } = await import("../action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      coworkerId: "coworker-1",
      currentStatus: TaskStatus.DRAFT,
      desiredStatus: TaskStatus.READY,
      hadSchedule: false,
      schedule: { mode: "none", timezone: "UTC" },
    });

    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("clears the schedule when reverting a queued task to draft", async () => {
    taskScheduleServiceMock.clearSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });

    const { updateTask } = await import("../action");

    await updateTask({
      taskId: "task-1",
      name: "Task",
      description: "Do work",
      coworkerId: "coworker-1",
      currentStatus: TaskStatus.QUEUED,
      desiredStatus: TaskStatus.DRAFT,
      hadSchedule: true,
      originalSchedule: recurringSchedule,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.clearSchedule).toHaveBeenCalledWith(
      "task-1",
    );
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
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
    taskScheduleServiceMock.clearSchedule.mockReset();
    taskServiceMock.createTaskEvent.mockResolvedValue({});
  });

  it("creates a status event for a simple draft to ready move", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.DRAFT,
      }),
    );

    const { setTaskStatusFromDrag } = await import("../action");

    await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
    });

    expect(taskScheduleServiceMock.clearSchedule).not.toHaveBeenCalled();
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("clears the schedule before moving a scheduled queued task to ready", async () => {
    taskServiceMock.getTaskById.mockResolvedValue({
      ...buildTask({
        id: "task-1",
        status: TaskStatus.QUEUED,
      }),
      metadata: scheduledMetadata,
      nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
    });
    taskScheduleServiceMock.clearSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });

    const { setTaskStatusFromDrag } = await import("../action");

    await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
    });

    expect(taskScheduleServiceMock.clearSchedule).toHaveBeenCalledWith(
      "task-1",
    );
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("clears the schedule without re-queuing when reverting a scheduled queued task to draft", async () => {
    taskServiceMock.getTaskById.mockResolvedValue({
      ...buildTask({
        id: "task-1",
        status: TaskStatus.QUEUED,
      }),
      metadata: scheduledMetadata,
      nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
    });
    taskScheduleServiceMock.clearSchedule.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });

    const { setTaskStatusFromDrag } = await import("../action");

    await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.DRAFT,
    });

    expect(taskScheduleServiceMock.clearSchedule).toHaveBeenCalledWith(
      "task-1",
    );
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
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
    taskScheduleServiceMock.clearSchedule.mockReset();
    taskScheduleServiceMock.setSchedule.mockReset();
    appendDesignMdToDescriptionMock.mockImplementation(
      async (description: string) => description,
    );
  });

  it("does not apply a schedule when saving as draft", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );

    const { createTask } = await import("../action");

    await createTask({
      description: "Draft task",
      coworkerId: null,
      status: TaskStatus.DRAFT,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).not.toHaveBeenCalled();
    expect(taskScheduleServiceMock.clearSchedule).not.toHaveBeenCalled();
  });

  it("applies a schedule when creating a ready task with a schedule", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.DRAFT }),
    );
    taskScheduleServiceMock.setSchedule.mockResolvedValue({
      id: "task-created",
      status: TaskStatus.QUEUED,
    });

    const { createTask } = await import("../action");

    await createTask({
      description: "Scheduled task",
      coworkerId: null,
      status: TaskStatus.READY,
      schedule: recurringSchedule,
    });

    expect(taskScheduleServiceMock.setSchedule).toHaveBeenCalled();
  });
});
