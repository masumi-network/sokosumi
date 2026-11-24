import type { Task } from "@sokosumi/core-client";
import {
  TaskLinkRelation,
  TaskPriority,
  TaskStatus,
} from "@sokosumi/core-client";
import { expectConsole } from "@sokosumi/utils/test-console";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  removeTaskParticipant: vi.fn(),
  subscribeTaskParticipant: vi.fn(),
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

function buildTask(
  overrides?: Partial<
    Pick<
      Task,
      | "id"
      | "name"
      | "description"
      | "assigneeId"
      | "projectId"
      | "status"
      | "identifier"
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
    identifier: null,
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
    expectConsole("error", "Failed to create task", 4);
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
    const errorCalls = expectConsole("error", "Failed to create task");
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
    expect(errorCalls[0]?.[1]).toBe(projectMissing);
  });

  it("archives the created task when creating the link fails after task creation", async () => {
    expectConsole("error", "Failed to create and link task");
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
        relation: TaskLinkRelation.RELATED,
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

  it.each([TaskStatus.READY, TaskStatus.QUEUED])(
    "leaves a Task Core parked for instructions over a %s run",
    async (status) => {
      taskServiceMock.patchTask.mockResolvedValue({
        id: "task-1",
        status: TaskStatus.INPUT_REQUIRED,
      });
      const { updateTask } = await import("./action");

      const result = await updateTask({ ...baseInput, desiredStatus: status });

      expect(taskServiceMock.createTaskEvent).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: true });
    },
  );

  it.each([TaskStatus.DRAFT, TaskStatus.CANCELED])(
    "still moves a parked Task to the %s the form chose",
    async (status) => {
      taskServiceMock.patchTask.mockResolvedValue({
        id: "task-1",
        status: TaskStatus.INPUT_REQUIRED,
      });
      const { updateTask } = await import("./action");

      await updateTask({ ...baseInput, desiredStatus: status });

      expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
        status,
      });
    },
  );

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

  it("clears Run at in the patch before assigning a human", async () => {
    taskServiceMock.patchTask.mockResolvedValue({
      id: "task-1",
      status: TaskStatus.DRAFT,
    });
    const { updateTask } = await import("./action");

    await updateTask({
      ...baseInput,
      assigneeId: null,
      assigneeUserId: "user-2",
      desiredStatus: TaskStatus.DRAFT,
      runAt: null,
    });

    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ assigneeUserId: "user-2", runAt: null }),
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

  it("revalidates the task route rather than one concrete URL", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({ id: "task-1", status: TaskStatus.DRAFT }),
    );

    const { setTaskStatusFromDrag } = await import("./action");
    const { revalidatePath } = await import("next/cache");
    await setTaskStatusFromDrag({
      taskId: "task-1",
      desiredStatus: TaskStatus.READY,
    });

    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/[taskId]", "page");
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

  it("rejects reopening a Coworker's completed Task to ready without a comment", async () => {
    expectConsole("error", "Failed to update task status");
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({
        id: "task-1",
        status: TaskStatus.COMPLETED,
        assigneeId: "cow_1",
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

  it("reopens a person's completed Task to ready without a comment", async () => {
    taskServiceMock.getTaskById.mockResolvedValue(
      buildTask({ id: "task-1", status: TaskStatus.COMPLETED }),
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

describe("task participant actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards mentioned workspace members with the comment", async () => {
    taskServiceMock.createTaskEvent.mockResolvedValue({ id: "event-1" });
    const { createTaskComment } = await import("./action");

    await createTaskComment({
      taskId: "task-1",
      comment: "  ping @user-2:ada  ",
      mentionedUserIds: ["user-2"],
    });

    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      comment: "ping @user-2:ada",
      mentionedUserIds: ["user-2"],
    });
  });

  it("omits mentionedUserIds when nobody is mentioned", async () => {
    taskServiceMock.createTaskEvent.mockResolvedValue({ id: "event-1" });
    const { createTaskComment } = await import("./action");

    await createTaskComment({ taskId: "task-1", comment: "plain" });

    expect(taskServiceMock.createTaskEvent).toHaveBeenCalledWith("task-1", {
      comment: "plain",
    });
  });

  it("unsubscribes the session user and reports success", async () => {
    taskServiceMock.removeTaskParticipant.mockResolvedValue([]);
    const { removeTaskParticipant } = await import("./action");

    const result = await removeTaskParticipant({
      taskId: "task-1",
    });

    expect(taskServiceMock.removeTaskParticipant).toHaveBeenCalledWith(
      "task-1",
      "user-1",
    );
    expect(result).toEqual({
      ok: true,
      value: { taskId: "task-1" },
    });
  });

  it("returns the Core error when unsubscribe fails", async () => {
    taskServiceMock.removeTaskParticipant.mockRejectedValue(
      new Error("Forbidden"),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      message: "Forbidden",
      code: "FORBIDDEN",
    });
    const { removeTaskParticipant } = await import("./action");

    const result = await removeTaskParticipant({
      taskId: "task-1",
    });

    expect(result).toEqual({
      ok: false,
      error: { message: "Forbidden", code: "FORBIDDEN" },
    });
  });

  it("subscribes the viewer as a Task participant", async () => {
    taskServiceMock.subscribeTaskParticipant.mockResolvedValue([]);
    const { subscribeTaskParticipant } = await import("./action");

    const result = await subscribeTaskParticipant({ taskId: "task-1" });

    expect(taskServiceMock.subscribeTaskParticipant).toHaveBeenCalledWith(
      "task-1",
    );
    expect(result).toEqual({
      ok: true,
      value: { taskId: "task-1" },
    });
  });

  it("returns the Core error when subscribe fails", async () => {
    taskServiceMock.subscribeTaskParticipant.mockRejectedValue(
      new Error("Forbidden"),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      message: "Forbidden",
      code: "FORBIDDEN",
    });
    const { subscribeTaskParticipant } = await import("./action");

    const result = await subscribeTaskParticipant({ taskId: "task-1" });

    expect(result).toEqual({
      ok: false,
      error: { message: "Forbidden", code: "FORBIDDEN" },
    });
  });
});

describe("draft task tag actions", () => {
  it.each([false, true])(
    "keeps workspace tags and the Jev receipt together when creating (related=%s)",
    async (related) => {
      taskServiceMock.createTask.mockReset().mockResolvedValue(buildTask());
      taskServiceMock.createTaskLink.mockResolvedValue({ id: "link-1" });
      taskServiceMock.listTaskLinks.mockResolvedValue([]);
      const { createTask, createTaskAndLink } = await import("./action");
      const input = {
        name: "Market research",
        description: "Research the market",
        assigneeId: null,
        status: TaskStatus.DRAFT,
        tagSuggestionReceipt: "receipt-1",
        workspaceTagIds: ["tag-1", "tag-2"],
        dismissedWorkspaceTagIds: ["not-for-this-task"],
        dismissedTopicIds: ["design" as const],
      };
      if (related)
        await createTaskAndLink({
          ...input,
          taskId: "parent-task",
          relation: "related",
        });
      else await createTask(input);
      expect(taskServiceMock.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          name: input.name,
          tagSuggestionReceipt: input.tagSuggestionReceipt,
          workspaceTagIds: input.workspaceTagIds,
          dismissedWorkspaceTagIds: input.dismissedWorkspaceTagIds,
          dismissedTopicIds: input.dismissedTopicIds,
        }),
      );
      expect(taskServiceMock.createTask.mock.calls[0]?.[0]).not.toHaveProperty(
        "expectedWorkspaceTagIds",
      );
      // Tags are automatic: nothing in web still sends hand corrections.
      expect(taskServiceMock.createTask.mock.calls[0]?.[0]).not.toHaveProperty(
        "tagCorrections",
      );
    },
  );

  it("sends an empty selection when an edit clears every workspace tag", async () => {
    taskServiceMock.patchTask.mockReset().mockResolvedValue(buildTask());
    const { updateTask } = await import("./action");
    await updateTask({
      taskId: "task-created",
      name: "Weekly report",
      description: "Summarise the week",
      assigneeId: null,
      desiredStatus: TaskStatus.READY,
      workspaceTagIds: [],
      expectedWorkspaceTagIds: ["before"],
    });
    expect(taskServiceMock.patchTask).toHaveBeenCalledWith(
      "task-created",
      expect.objectContaining({
        workspaceTagIds: [],
        expectedWorkspaceTagIds: ["before"],
      }),
    );
  });

  it("dismisses a suggestion without replacing the applied workspace tags", async () => {
    const tags = { automatic: [], manual: [], rejected: ["design"] };
    const workspaceTags = [
      { id: "kept", displayName: "Release", source: "manual" },
    ];
    taskServiceMock.patchTask
      .mockReset()
      .mockResolvedValue({ tags, workspaceTags, workspaceTagSuggestions: [] });
    const { setTaskWorkspaceTags } = await import("./action");
    const result = await setTaskWorkspaceTags({
      taskId: "task",
      dismissedWorkspaceTagIds: ["declined"],
      dismissedTopicIds: ["design"],
    });
    expect(taskServiceMock.patchTask).toHaveBeenCalledWith("task", {
      dismissedWorkspaceTagIds: ["declined"],
      dismissedTopicIds: ["design"],
    });
    expect(result).toEqual({
      ok: true,
      value: { tags, workspaceTags, workspaceTagSuggestions: [] },
    });
  });

  it("forwards a copy's source Task so Core takes its tags", async () => {
    taskServiceMock.createTask.mockReset().mockResolvedValue(buildTask());
    const { createTask } = await import("./action");
    await createTask({
      name: "Weekly report",
      description: "Summarise the week",
      assigneeId: null,
      status: TaskStatus.DRAFT,
      copyOfTaskId: "source-task",
      dismissedTopicIds: ["design"],
    });
    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Weekly report",
        copyOfTaskId: "source-task",
        dismissedTopicIds: ["design"],
      }),
    );
  });
});

describe("setTaskPriority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.patchTask.mockReset();
    taskServiceMock.patchTask.mockResolvedValue({});
  });

  it("patches only the priority", async () => {
    const { setTaskPriority } = await import("./action");

    const result = await setTaskPriority({
      taskId: "task-1",
      priority: TaskPriority.URGENT,
    });

    expect(taskServiceMock.patchTask).toHaveBeenCalledWith("task-1", {
      priority: TaskPriority.URGENT,
    });
    expect(result).toEqual({ ok: true, value: { taskId: "task-1" } });
  });

  it("surfaces a Core failure instead of swallowing it", async () => {
    expectConsole("error", "Failed to update task priority");
    taskServiceMock.patchTask.mockRejectedValue(new Error("Core down"));
    const { setTaskPriority } = await import("./action");

    await expect(
      setTaskPriority({ taskId: "task-1", priority: TaskPriority.LOW }),
    ).rejects.toThrow();
  });
});

describe("setTaskDueOn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.patchTask.mockReset();
    taskServiceMock.patchTask.mockResolvedValue({});
  });

  it("patches only the due date, and clears it with null", async () => {
    const { setTaskDueOn } = await import("./action");

    const result = await setTaskDueOn({
      taskId: "task-1",
      dueOn: "2026-11-20",
    });
    await setTaskDueOn({ taskId: "task-1", dueOn: null });

    expect(taskServiceMock.patchTask).toHaveBeenNthCalledWith(1, "task-1", {
      dueOn: "2026-11-20",
    });
    expect(taskServiceMock.patchTask).toHaveBeenNthCalledWith(2, "task-1", {
      dueOn: null,
    });
    expect(result).toEqual({ ok: true, value: { taskId: "task-1" } });
  });
});

describe("archiveTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskServiceMock.deleteTask.mockReset();
    taskServiceMock.deleteTask.mockResolvedValue(buildTask({ id: "t1" }));
    toCoreApiActionErrorMock.mockReset();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      message:
        error instanceof Error
          ? error.message
          : "Failed to communicate with Core API",
    }));
  });

  it("deletes the trimmed task id and revalidates /tasks", async () => {
    const { revalidatePath } = await import("next/cache");
    const { archiveTask } = await import("./action");

    await archiveTask({ taskId: "  t1  " });

    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("t1");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/[taskId]", "page");
  });

  it("rethrows without revalidating when deleteTask rejects", async () => {
    expectConsole("error", "Failed to archive task");
    const { revalidatePath } = await import("next/cache");
    taskServiceMock.deleteTask.mockRejectedValueOnce(new Error("Core down"));
    const { archiveTask } = await import("./action");

    await expect(archiveTask({ taskId: "t1" })).rejects.toThrow("Core down");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("throws when taskId is blank without calling deleteTask or revalidating", async () => {
    const { revalidatePath } = await import("next/cache");
    const { archiveTask } = await import("./action");

    await expect(archiveTask({ taskId: "   " })).rejects.toThrow(
      "Task required",
    );
    expect(taskServiceMock.deleteTask).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
