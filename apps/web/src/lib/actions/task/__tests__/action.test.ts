import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TASK_NAME_MAX_LENGTH } from "@/lib/utils/task-transformer";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

const generateTaskNameMock = vi.fn();
const taskServiceMock = {
  listTaskLinks: vi.fn(),
  deleteTaskLink: vi.fn(),
  createTaskLink: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
};
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: toCoreApiActionErrorMock,
}));

vi.mock("@/lib/clients/openrouter.client", () => ({
  openrouterClient: {
    generateTaskName: generateTaskNameMock,
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

function buildTask(overrides?: Partial<{ id: string; name: string }>) {
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
    toCoreApiActionErrorMock.mockReturnValue({
      message: "Core API failed",
    });
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

  it("clamps generated task names before creating a task", async () => {
    const longGeneratedName = "A".repeat(DEFAULT_TASK_NAME_MAX_LENGTH + 25);
    generateTaskNameMock.mockResolvedValue(longGeneratedName);
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("../action");

    await createTask({
      description: "Created related task",
      coworkerId: null,
      status: TaskStatus.READY,
    });

    expect(taskServiceMock.createTask).toHaveBeenCalledWith({
      name: "A".repeat(DEFAULT_TASK_NAME_MAX_LENGTH),
      description: "Created related task",
      coworkerId: null,
      status: TaskStatus.READY,
    });
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
    ).rejects.toThrow("Core API failed");

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
    ).rejects.toThrow("Core API failed");

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

  it("archives the created task when creating the link fails after task creation", async () => {
    generateTaskNameMock.mockResolvedValue("Generated task name");
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
    ).rejects.toThrow("Core API failed");

    expect(taskServiceMock.createTask).toHaveBeenCalledWith({
      name: "Generated task name",
      description: "Created related task",
      coworkerId: null,
      status: TaskStatus.READY,
    });
    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith("task-created");
  });

  it("archives the created task after rolling back a failed parent cleanup", async () => {
    generateTaskNameMock.mockResolvedValue("Generated task name");
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
    ).rejects.toThrow("Core API failed");

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
