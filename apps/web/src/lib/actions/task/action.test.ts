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
  listTaskLinks: vi.fn(),
  deleteTaskLink: vi.fn(),
  createTaskLink: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  patchTask: vi.fn(),
  createTaskEvent: vi.fn(),
  getTaskById: vi.fn(),
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
    >
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
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.getTaskById.mockReset();
    taskServiceMock.createTaskEvent.mockReset();
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
