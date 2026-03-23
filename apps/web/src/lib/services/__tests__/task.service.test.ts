import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { TaskStatus } from "@sokosumi/database";

const coreClientMock = {
  createTask: vi.fn(),
  createTaskEvent: vi.fn(),
  deleteTask: vi.fn(),
  getTaskById: vi.fn(),
  getTasks: vi.fn(),
  patchTask: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

function buildTask() {
  return {
    id: "task-1",
    createdAt: "2026-02-19T10:00:00.000Z",
    updatedAt: "2026-02-19T10:00:00.000Z",
    userId: "user-1",
    organizationId: null,
    coworkerId: null,
    name: "Test task",
    description: null,
    status: TaskStatus.READY,
    events: [],
    jobs: [],
  };
}

describe("task.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists tasks and normalizes status for the core client", async () => {
    coreClientMock.getTasks.mockResolvedValue({
      data: [buildTask()],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 50,
          nextCursor: "task-2",
        },
      },
    });

    const { taskService } = await import("../task.service");
    const result = await taskService.listTasks({
      status: TaskStatus.READY,
      coworkerId: "cow-1",
      cursor: "task-1",
      limit: 20,
    });

    expect(coreClientMock.getTasks).toHaveBeenCalledWith({
      status: [TaskStatus.READY],
      coworkerId: "cow-1",
      cursor: "task-1",
      limit: 20,
    });
    expect(result).toEqual({
      tasks: [buildTask()],
      pagination: {
        cursor: null,
        limit: 20,
        total: 50,
        nextCursor: "task-2",
      },
    });
  });

  it("passes through multiple statuses for the core client", async () => {
    coreClientMock.getTasks.mockResolvedValue({
      data: [buildTask()],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 50,
          nextCursor: "task-2",
        },
      },
    });

    const { taskService } = await import("../task.service");
    await taskService.listTasks({
      status: [TaskStatus.READY, TaskStatus.COMPLETED],
      limit: 20,
    });

    expect(coreClientMock.getTasks).toHaveBeenCalledWith({
      status: [TaskStatus.READY, TaskStatus.COMPLETED],
      coworkerId: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("returns null when getTaskById fails", async () => {
    coreClientMock.getTaskById.mockRejectedValue(new Error("not found"));

    const { taskService } = await import("../task.service");
    const result = await taskService.getTaskById("task-missing");

    expect(result).toBeNull();
  });

  it("creates, updates, and deletes tasks via core client methods", async () => {
    const task = buildTask();
    coreClientMock.createTask.mockResolvedValue({ data: task });
    coreClientMock.patchTask.mockResolvedValue({
      data: { ...task, name: "Updated task" },
    });
    coreClientMock.deleteTask.mockResolvedValue({ data: task });

    const { taskService } = await import("../task.service");

    const created = await taskService.createTask({
      name: "Test task",
      description: null,
      coworkerId: null,
      status: TaskStatus.READY,
    });
    const updated = await taskService.patchTask("task-1", {
      name: "Updated task",
    });
    const deleted = await taskService.deleteTask("task-1");

    expect(coreClientMock.createTask).toHaveBeenCalledWith({
      name: "Test task",
      description: null,
      coworkerId: null,
      status: TaskStatus.READY,
    });
    expect(coreClientMock.patchTask).toHaveBeenCalledWith("task-1", {
      name: "Updated task",
    });
    expect(coreClientMock.deleteTask).toHaveBeenCalledWith("task-1");
    expect(created).toEqual(task);
    expect(updated).toEqual({ ...task, name: "Updated task" });
    expect(deleted).toEqual(task);
  });

  it("throws when createTaskEvent returns no data", async () => {
    coreClientMock.createTaskEvent.mockResolvedValue({ data: null });

    const { taskService } = await import("../task.service");

    await expect(
      taskService.createTaskEvent("task-1", {
        status: TaskStatus.RUNNING,
        comment: "in progress",
      }),
    ).rejects.toThrow("Failed to create task event");
  });
});
