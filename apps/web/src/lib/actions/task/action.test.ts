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
  moveCalendarSeriesSource: vi.fn(),
  mutateOccurrence: vi.fn(),
};
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

  it("creates a related Task at its Run at", async () => {
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.QUEUED }),
    );
    taskServiceMock.listTaskLinks.mockResolvedValue([]);
    taskServiceMock.createTaskLink.mockResolvedValue({ id: "link-new" });
    const { createTaskAndLink } = await import("./action");

    const result = await createTaskAndLink({
      taskId: "task-1",
      description: "Related queued task",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.QUEUED,
      runAt: "2030-01-02T09:00:00.000Z",
      relation: TaskLinkRelation.RELATED,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ createdTaskId: "task-created" }),
      }),
    );
    const createInput = taskServiceMock.createTask.mock.calls[0]?.[0];
    expect(createInput).toEqual(
      expect.objectContaining({
        runAt: new Date("2030-01-02T09:00:00.000Z"),
      }),
    );
    expect(createInput).not.toHaveProperty("status");
  });
});

describe("updateTask context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });
    taskServiceMock.createTaskEvent.mockResolvedValue({});
  });

  it("maps Context selection into the Core patch payload", async () => {
    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Launch post",
      description: "Draft the LinkedIn launch post",
      assigneeId: "cow_1",
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      context: {
        brand: { enabled: false, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: false,
      },
      desiredStatus: TaskStatus.DRAFT,
    });

    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        description: "Draft the LinkedIn launch post",
        context: {
          brand: false,
          briefing: true,
          memory: false,
        },
      }),
    );
  });

  it("allows an empty body when Context will re-attach files", async () => {
    const { updateTask } = await import("./action");

    await updateTask({
      taskId: "task-1",
      name: "Launch post",
      description: "   ",
      assigneeId: "cow_1",
      context: {
        brand: { enabled: true, source: "default", custom: null },
        briefingEnabled: false,
        contextMdEnabled: false,
      },
      desiredStatus: TaskStatus.DRAFT,
    });

    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        description: "",
        context: expect.objectContaining({ brand: true }),
      }),
    );
  });

  it("rejects an empty body when every Context chip is off", async () => {
    const { updateTask } = await import("./action");

    await expect(
      updateTask({
        taskId: "task-1",
        name: "Launch post",
        description: "",
        assigneeId: "cow_1",
        context: {
          brand: { enabled: false, source: "default", custom: null },
          briefingEnabled: false,
          contextMdEnabled: false,
        },
        desiredStatus: TaskStatus.DRAFT,
      }),
    ).rejects.toThrow("Description required");
  });
});

describe("updateTask Run at", () => {
  const baseInput = {
    taskId: "task-1",
    name: "Task",
    description: "Do work",
    assigneeId: "coworker-1",
    assigneeSokoBotId: null,
    assigneeUserId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.createTaskEvent.mockResolvedValue({});
  });

  it("queues the Task through the patch without a status event", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.QUEUED,
    });
    const { updateTask } = await import("./action");

    await updateTask({
      ...baseInput,
      desiredStatus: TaskStatus.QUEUED,
      runAt: "2030-01-02T09:00:00.000Z",
    });

    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        runAt: new Date("2030-01-02T09:00:00.000Z"),
      }),
    );
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("sends no Run at when none is given", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.QUEUED,
    });
    const { updateTask } = await import("./action");

    await updateTask({ ...baseInput, desiredStatus: TaskStatus.QUEUED });

    expect(taskServiceMock.patchTask.mock.calls[0]?.[1]).not.toHaveProperty(
      "runAt",
    );
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("leaves Queued with a status event, which clears the Run at on Core", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.QUEUED,
    });
    const { updateTask } = await import("./action");

    await updateTask({ ...baseInput, desiredStatus: TaskStatus.READY });

    expect(taskServiceMock.patchTask.mock.calls[0]?.[1]).not.toHaveProperty(
      "runAt",
    );
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("applies a Draft to Ready move after the patch", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });
    const { updateTask } = await import("./action");

    await updateTask({ ...baseInput, desiredStatus: TaskStatus.READY });

    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.READY,
    });
  });

  it("maps a refused status move to its stable result kind", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskServiceMock.createTaskEvent.mockRejectedValue(
      new CoreApiRequestError("Status not selectable", {
        status: 422,
        kind: "status_not_selectable",
      }),
    );
    const { updateTask } = await import("./action");

    const result = await updateTask({
      ...baseInput,
      desiredStatus: TaskStatus.READY,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
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

  it("allows Ready → Queued on a live series (Core's selectable exception)", async () => {
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
      desiredStatus: TaskStatus.QUEUED,
    });

    expect(result).toEqual({ ok: true, value: { taskId: "task-1" } });
    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      status: TaskStatus.QUEUED,
    });
    expect(taskScheduleServiceMock.removeCalendarSeries).not.toHaveBeenCalled();
  });

  it("rejects Ready → Draft on a live series as schedule_active", async () => {
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

describe("createTask Run at", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.createTask.mockReset();
    taskServiceMock.createTaskEvent.mockReset();
    taskServiceMock.createTask.mockResolvedValue(
      buildTask({ status: TaskStatus.QUEUED }),
    );
  });

  it("sends the Run at and lets Core queue the Task", async () => {
    const { createTask } = await import("./action");

    await createTask({
      description: "Queued task",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.QUEUED,
      runAt: "2030-01-02T09:00:00.000Z",
    });

    const createInput = taskServiceMock.createTask.mock.calls[0]?.[0];
    expect(createInput).toEqual(
      expect.objectContaining({
        runAt: new Date("2030-01-02T09:00:00.000Z"),
      }),
    );
    expect(createInput).not.toHaveProperty("status");
    expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
  });

  it("creates a Queued request without a Run at as Ready", async () => {
    const { createTask } = await import("./action");

    await createTask({
      description: "Queued task",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.QUEUED,
    });

    const createInput = taskServiceMock.createTask.mock.calls[0]?.[0];
    expect(createInput).toEqual(
      expect.objectContaining({ status: TaskStatus.READY }),
    );
    expect(createInput).not.toHaveProperty("runAt");
  });

  it("keeps a Draft create without a Run at", async () => {
    const { createTask } = await import("./action");

    await createTask({
      description: "Draft task",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.DRAFT,
    });

    expect(taskServiceMock.createTask.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ status: TaskStatus.DRAFT }),
    );
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

  it("moves a series source and revalidates both Project calendars", async () => {
    taskScheduleServiceMock.moveCalendarSeriesSource.mockResolvedValue({
      previousSource: { type: "project", projectId: "project-old" },
      source: { type: "project", projectId: "project-new" },
      scheduleRevision: 4,
      canceledFutureExceptionCount: 2,
    });
    const { moveCalendarTaskSource } = await import("./action");

    const result = await moveCalendarTaskSource({
      taskId: "task-1",
      operationId,
      expectedScheduleRevision: 3,
      source: {
        type: "project",
        projectId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(
      taskScheduleServiceMock.moveCalendarSeriesSource,
    ).toHaveBeenCalledWith(
      "task-1",
      { operationId, expectedScheduleRevision: 3 },
      {
        type: "project",
        projectId: "11111111-1111-4111-8111-111111111111",
      },
    );
    expect(result).toEqual({
      ok: true,
      value: { taskId: "task-1", scheduleRevision: 4 },
    });
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/task-1");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/projects/project-old/calendar",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/projects/project-new/calendar",
    );
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
  });
});

describe("mutateTaskOccurrence", () => {
  const operationId = "123e4567-e89b-42d3-a456-426614174000";
  const scheduledAt = "2030-01-02T10:30:00.000Z";

  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.getTaskById.mockReset();
    taskScheduleServiceMock.mutateOccurrence.mockReset();
  });

  it("uses the UI-observed revision even when the task read is newer", async () => {
    taskServiceMock.getTaskById.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      scheduleRevision: 8,
    });
    taskScheduleServiceMock.mutateOccurrence.mockResolvedValue({
      scheduleRevision: 4,
      occurrence: { id: "occurrence-1" },
    });
    const { mutateTaskOccurrence } = await import("./action");

    const result = await mutateTaskOccurrence({
      taskId: "task-1",
      occurrenceId: "occurrence-1",
      operationId,
      expectedScheduleRevision: 3,
      action: "reschedule",
      scheduledAt,
    });

    expect(taskServiceMock.getTaskById).toHaveBeenCalledWith("task-1");
    expect(taskScheduleServiceMock.mutateOccurrence).toHaveBeenCalledWith(
      "task-1",
      "occurrence-1",
      {
        operationId,
        expectedScheduleRevision: 3,
        action: "reschedule",
        scheduledAt: new Date(scheduledAt),
      },
    );
    expect(result).toEqual({
      ok: true,
      value: { taskId: "task-1", scheduleRevision: 4 },
    });
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/calendar");
  });

  it("maps a non-reschedulable occurrence to its stable result kind", async () => {
    taskServiceMock.getTaskById.mockResolvedValue({
      id: "task-1",
      scheduleRevision: 3,
    });
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    taskScheduleServiceMock.mutateOccurrence.mockRejectedValue(
      new CoreApiRequestError("Only a future unreleased occurrence can move", {
        status: 409,
        kind: "schedule_occurrence_not_reschedulable",
      }),
    );
    const { mutateTaskOccurrence } = await import("./action");

    await expect(
      mutateTaskOccurrence({
        taskId: "task-1",
        occurrenceId: "occurrence-1",
        operationId,
        expectedScheduleRevision: 3,
        action: "reschedule",
        scheduledAt,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "schedule_occurrence_not_reschedulable" },
    });
  });

  it("requires a UUID operation identity before reading the task", async () => {
    const { mutateTaskOccurrence } = await import("./action");

    await expect(
      mutateTaskOccurrence({
        taskId: "task-1",
        occurrenceId: "occurrence-1",
        operationId: "not-a-uuid",
        expectedScheduleRevision: 3,
        action: "reschedule",
        scheduledAt,
      }),
    ).rejects.toThrow("Operation ID must be a UUID");
    expect(taskServiceMock.getTaskById).not.toHaveBeenCalled();
    expect(taskScheduleServiceMock.mutateOccurrence).not.toHaveBeenCalled();
  });

  it.each([
    { action: "skip" as const },
    { action: "restore" as const },
    { action: "restore" as const, scheduledAt },
  ])("forwards an $action occurrence mutation", async (mutation) => {
    taskServiceMock.getTaskById.mockResolvedValue({
      id: "task-1",
      scheduleRevision: 3,
    });
    taskScheduleServiceMock.mutateOccurrence.mockResolvedValue({
      scheduleRevision: 4,
      occurrence: { id: "occurrence-1" },
    });
    const { mutateTaskOccurrence } = await import("./action");

    await mutateTaskOccurrence({
      taskId: "task-1",
      occurrenceId: "occurrence-1",
      operationId,
      expectedScheduleRevision: 3,
      ...mutation,
    });

    expect(taskScheduleServiceMock.mutateOccurrence).toHaveBeenCalledWith(
      "task-1",
      "occurrence-1",
      {
        operationId,
        expectedScheduleRevision: 3,
        ...(mutation.scheduledAt
          ? {
              action: mutation.action,
              scheduledAt: new Date(mutation.scheduledAt),
            }
          : { action: mutation.action }),
      },
    );
  });
});
