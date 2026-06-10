import { TaskLinkType } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
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

const generateTaskNameMock = vi.fn();
const appendDesignMdToDescriptionMock = vi.fn();
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

vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: {
    appendDesignMdToDescription: (...args: unknown[]) =>
      appendDesignMdToDescriptionMock(...args),
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
    taskServiceMock.listTaskLinks.mockReset();
    taskServiceMock.deleteTaskLink.mockReset();
    taskServiceMock.createTaskLink.mockReset();
    taskServiceMock.createTask.mockReset();
    taskServiceMock.deleteTask.mockReset();
    generateTaskNameMock.mockReset();
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
      projectId: null,
      status: TaskStatus.READY,
    });
  });

  it("prepends the effective design.md attachment before creating a task", async () => {
    generateTaskNameMock.mockResolvedValue("Generated task name");
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
    expect(generateTaskNameMock).toHaveBeenCalledWith("Created related task");
  });

  it("skips design.md attachment when the composer removed it", async () => {
    generateTaskNameMock.mockResolvedValue("Generated task name");
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
  });

  it("generates task names from user instructions when DESIGN.md is pre-seeded", async () => {
    generateTaskNameMock.mockResolvedValue("Build landing page");
    appendDesignMdToDescriptionMock.mockImplementation(
      async (description: string) => description,
    );
    taskServiceMock.createTask.mockResolvedValue(buildTask());

    const { createTask } = await import("../action");

    await createTask({
      description:
        "[DESIGN.md](https://blob.example/design.md)\n\nBuild landing page",
      coworkerId: null,
      status: TaskStatus.READY,
    });

    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Build landing page",
        description:
          "[DESIGN.md](https://blob.example/design.md)\n\nBuild landing page",
      }),
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
    ).rejects.toThrow("link failed");

    expect(taskServiceMock.createTask).toHaveBeenCalledWith({
      name: "Generated task name",
      description: "Created related task",
      coworkerId: null,
      projectId: null,
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
