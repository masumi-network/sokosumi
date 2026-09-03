import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AgentJobStatus, TaskStatus } from "@/lib/clients/generated/core";

const coreClientMock = {
  createScheduledTask: vi.fn(),
  createTaskLink: vi.fn(),
  createTask: vi.fn(),
  createTaskEvent: vi.fn(),
  deleteTaskLink: vi.fn(),
  deleteTask: vi.fn(),
  getJobs: vi.fn(),
  getTaskById: vi.fn(),
  getTaskLinks: vi.fn(),
  getTasks: vi.fn(),
  getTasksSummary: vi.fn(),
  getWorkspaceCalendar: vi.fn(),
  getWorkspaceCalendarSources: vi.fn(),
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
    ownerId: "user-1",
    organizationId: null,
    assigneeId: null,
    assigneeSokoBotId: null,
    name: "Test task",
    description: null,
    status: TaskStatus.READY,
    events: [],
    jobs: [],
  };
}

function buildTaskLink() {
  return {
    id: "link-1",
    createdAt: new Date("2026-02-19T10:00:00.000Z"),
    updatedAt: new Date("2026-02-19T10:00:00.000Z"),
    relation: "related" as const,
    note: null,
    peerTask: {
      id: "task-2",
      name: "Peer task",
      status: TaskStatus.READY,
      archivedAt: null,
    },
  };
}

describe("task.service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

    const { taskService } = await import("./task.service");
    const result = await taskService.listTasks({
      status: TaskStatus.READY,
      assigneeId: "cow-1",
      q: "alpha",
      cursor: "task-1",
      limit: 20,
    });

    expect(coreClientMock.getTasks).toHaveBeenCalledWith({
      status: [TaskStatus.READY],
      assigneeId: "cow-1",
      q: "alpha",
      cursor: "task-1",
      limit: 20,
      projectId: undefined,
      scope: undefined,
      sort: undefined,
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

  it("returns an empty task list when core data is missing", async () => {
    coreClientMock.getTasks.mockResolvedValue({
      data: undefined,
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 0,
          nextCursor: null,
        },
      },
    });

    const { taskService } = await import("./task.service");
    const result = await taskService.listTasks({ limit: 20 });

    expect(result).toEqual({
      tasks: [],
      pagination: {
        cursor: null,
        limit: 20,
        total: 0,
        nextCursor: null,
      },
    });
  });

  it("loads the active workspace calendar through Core", async () => {
    coreClientMock.getWorkspaceCalendar.mockResolvedValue({
      data: [
        {
          id: "occurrence-1",
          taskId: "task-1",
          taskName: "Test task",
          taskStatus: TaskStatus.QUEUED,
          taskAssigneeId: "coworker-1",
          scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 100,
          total: 1,
          nextCursor: null,
        },
      },
    });
    const { taskService } = await import("./task.service");
    const result = await taskService.getWorkspaceCalendar({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      limit: 100,
    });

    expect(coreClientMock.getWorkspaceCalendar).toHaveBeenCalledWith({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      limit: 100,
    });
    expect(coreClientMock.getTasks).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
  });

  it("loads the active workspace calendar source catalog through Core", async () => {
    coreClientMock.getWorkspaceCalendarSources.mockResolvedValue({
      data: [
        {
          sourceId: "workspace:workspace-1",
          sourceType: "WORKSPACE",
          displayName: "Ada's workspace",
          logoUrl: null,
          paletteToken: "blue",
          isSchedulable: true,
        },
      ],
    });
    const { taskService } = await import("./task.service");

    await expect(taskService.getWorkspaceCalendarSources()).resolves.toEqual([
      {
        sourceId: "workspace:workspace-1",
        sourceType: "WORKSPACE",
        displayName: "Ada's workspace",
        logoUrl: null,
        paletteToken: "blue",
        isSchedulable: true,
      },
    ]);
    expect(coreClientMock.getWorkspaceCalendarSources).toHaveBeenCalledOnce();
  });

  it("loads one bounded calendar page", async () => {
    coreClientMock.getWorkspaceCalendar.mockResolvedValueOnce({
      data: [
        {
          id: "occurrence-1",
          taskId: "task-1",
          taskName: "First task",
          taskStatus: TaskStatus.QUEUED,
          taskAssigneeId: "coworker-1",
          scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 100,
          total: 2,
          nextCursor: "calendar-2",
        },
      },
    });
    const { taskService } = await import("./task.service");
    const result = await taskService.getWorkspaceCalendar({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      limit: 100,
    });

    expect(result.items.map((item) => item.id)).toEqual(["occurrence-1"]);
    expect(coreClientMock.getWorkspaceCalendar).toHaveBeenCalledOnce();
    expect(coreClientMock.getWorkspaceCalendar).toHaveBeenCalledWith({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      limit: 100,
    });
    expect(coreClientMock.getTasks).not.toHaveBeenCalled();
  });

  it("keeps calendar items available without unrelated task reads", async () => {
    coreClientMock.getWorkspaceCalendar.mockResolvedValue({
      data: [
        {
          id: "occurrence-1",
          taskId: "task-1",
          taskName: "Test task",
          taskStatus: TaskStatus.QUEUED,
          taskAssigneeId: null,
          scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
        },
      ],
    });
    const { taskService } = await import("./task.service");
    const result = await taskService.getWorkspaceCalendar({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      limit: 100,
    });

    expect(result.items).toHaveLength(1);
    expect(coreClientMock.getTasks).not.toHaveBeenCalled();
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

    const { taskService } = await import("./task.service");
    await taskService.listTasks({
      status: [TaskStatus.READY, TaskStatus.COMPLETED],
      limit: 20,
    });

    expect(coreClientMock.getTasks).toHaveBeenCalledWith({
      status: [TaskStatus.READY, TaskStatus.COMPLETED],
      assigneeId: undefined,
      q: undefined,
      cursor: undefined,
      limit: 20,
      projectId: undefined,
      scope: undefined,
      sort: undefined,
    });
  });

  it("forwards input-required column statuses to the core client", async () => {
    coreClientMock.getTasks.mockResolvedValue({
      data: [buildTask()],
      meta: {
        pagination: {
          cursor: null,
          limit: 10,
          total: 1,
          nextCursor: null,
        },
      },
    });

    const { taskService } = await import("./task.service");
    await taskService.listTasks({
      status: [TaskStatus.GRANT_PENDING, TaskStatus.INPUT_REQUIRED],
      limit: 10,
    });

    expect(coreClientMock.getTasks).toHaveBeenCalledWith({
      status: [TaskStatus.GRANT_PENDING, TaskStatus.INPUT_REQUIRED],
      assigneeId: undefined,
      q: undefined,
      scope: undefined,
      cursor: undefined,
      limit: 10,
      projectId: undefined,
      sort: undefined,
    });
  });

  it("forwards jobs filters to the core client", async () => {
    const job = {
      id: "job-1",
      createdAt: new Date("2026-02-19T10:00:00.000Z"),
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      completedAt: null,
      agentId: "agent-1",
      userId: "user-1",
      organizationId: null,
      taskId: "task-1",
      name: "Test job",
      jobType: "PAID" as const,
      status: "processing" as const,
      credits: 5,
      onChainStatus: null,
      onChainTransactionHash: null,
      result: null,
      resultHash: null,
      workspace: {
        id: "workspace-1",
        organizationId: null,
        organization: null,
      },
    };
    coreClientMock.getJobs.mockResolvedValue({
      data: [job],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 1,
          nextCursor: "job-2",
        },
      },
    });

    const { taskService } = await import("./task.service");
    const result = await taskService.listJobs({
      scope: "workspace",
      agentId: "agent-1",
      status: AgentJobStatus.RUNNING,
      cursor: "job-1",
      limit: 20,
    });

    expect(coreClientMock.getJobs).toHaveBeenCalledWith({
      scope: "workspace",
      agentId: "agent-1",
      status: AgentJobStatus.RUNNING,
      cursor: "job-1",
      limit: 20,
    });
    expect(result).toEqual({
      jobs: [job],
      pagination: {
        cursor: null,
        limit: 20,
        total: 1,
        nextCursor: "job-2",
      },
    });
  });

  it("forwards scope when provided", async () => {
    coreClientMock.getTasks.mockResolvedValue({
      data: [buildTask()],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 1,
          nextCursor: null,
        },
      },
    });

    const { taskService } = await import("./task.service");
    await taskService.listTasks({
      scope: "owned",
      limit: 20,
    });

    expect(coreClientMock.getTasks).toHaveBeenCalledWith({
      status: undefined,
      assigneeId: undefined,
      q: undefined,
      scope: "owned",
      cursor: undefined,
      limit: 20,
      projectId: undefined,
      sort: undefined,
    });
  });

  it("returns null when getTaskById fails", async () => {
    coreClientMock.getTaskById.mockRejectedValue(new Error("not found"));

    const { taskService } = await import("./task.service");
    const result = await taskService.getTaskById("task-missing");

    expect(coreClientMock.getTaskById).toHaveBeenCalledWith("task-missing");
    expect(result).toBeNull();
  });

  it("creates, updates, and deletes tasks via core client methods", async () => {
    const task = buildTask();
    coreClientMock.createTask.mockResolvedValue({ data: task });
    coreClientMock.patchTask.mockResolvedValue({
      data: { ...task, name: "Updated task" },
    });
    coreClientMock.deleteTask.mockResolvedValue({ data: task });

    const { taskService } = await import("./task.service");

    const created = await taskService.createTask({
      name: "Test task",
      description: null,
      assigneeId: null,
      assigneeSokoBotId: null,
      context: {
        brand: true,
        brandSource: "project",
        briefing: true,
        memory: false,
      },
      status: TaskStatus.READY,
    });
    const updated = await taskService.patchTask("task-1", {
      name: "Updated task",
    });
    const deleted = await taskService.deleteTask("task-1");

    expect(coreClientMock.createTask).toHaveBeenCalledWith({
      name: "Test task",
      description: null,
      assigneeId: null,
      assigneeSokoBotId: null,
      context: {
        brand: true,
        brandSource: "project",
        briefing: true,
        memory: false,
      },
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

  it("forwards scheduled task creation to Core with the caller operation and source", async () => {
    const task = buildTask();
    const input = {
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      source: { type: "project" as const, projectId: "project-1" },
      name: "Scheduled task",
      description: "Prepare the brief",
      assigneeId: "coworker-1",
      schedule: {
        mode: "recurring" as const,
        expr: "0 9 * * *",
        timezone: "UTC",
      },
    };
    coreClientMock.createScheduledTask.mockResolvedValue({ data: task });

    const { taskService } = await import("./task.service");
    const created = await taskService.createScheduledTask(input);

    expect(coreClientMock.createScheduledTask).toHaveBeenCalledWith(input);
    expect(created).toEqual(task);
  });

  it("throws when createTaskEvent returns no data", async () => {
    coreClientMock.createTaskEvent.mockResolvedValue({ data: null });

    const { taskService } = await import("./task.service");

    await expect(
      taskService.createTaskEvent("task-1", {
        status: TaskStatus.RUNNING,
        comment: "in progress",
      }),
    ).rejects.toThrow("Failed to create task event");
  });

  it("lists task links via core client", async () => {
    const taskLink = buildTaskLink();
    coreClientMock.getTaskLinks.mockResolvedValue({
      data: [taskLink],
      meta: {},
    });

    const { taskService } = await import("./task.service");
    const result = await taskService.listTaskLinks("task-1");

    expect(coreClientMock.getTaskLinks).toHaveBeenCalledWith("task-1");
    expect(result).toEqual([taskLink]);
  });

  it("creates and deletes task links via core client methods", async () => {
    const taskLink = buildTaskLink();
    coreClientMock.createTaskLink.mockResolvedValue({
      data: taskLink,
    });
    coreClientMock.deleteTaskLink.mockResolvedValue({
      data: { deleted: true },
    });

    const { taskService } = await import("./task.service");
    const created = await taskService.createTaskLink("task-1", {
      toTaskId: "task-2",
      relation: "related",
      note: null,
    });
    const deleted = await taskService.deleteTaskLink("task-1", "link-1");

    expect(coreClientMock.createTaskLink).toHaveBeenCalledWith("task-1", {
      toTaskId: "task-2",
      relation: "related",
      note: null,
    });
    expect(coreClientMock.deleteTaskLink).toHaveBeenCalledWith(
      "task-1",
      "link-1",
    );
    expect(created).toEqual(taskLink);
    expect(deleted).toEqual({ deleted: true });
  });

  it("returns the activity summary DTO untouched", async () => {
    const summary = {
      awaitingInput: 2,
      basis: "lastVisit" as const,
      completed: 4,
      createdByOtherHumans: 3,
      lastVisitAt: new Date("2026-08-10T09:00:00.000Z"),
      since: new Date("2026-08-10T09:00:00.000Z"),
      workedMinutes: 47,
    };
    coreClientMock.getTasksSummary.mockResolvedValue({ data: summary });

    const { taskService } = await import("./task.service");
    const result = await taskService.getActivitySummary({ scope: "workspace" });

    expect(coreClientMock.getTasksSummary).toHaveBeenCalledWith({
      scope: "workspace",
    });
    expect(result).toBe(summary);
  });

  // Null, not zeros: the landing hides chips rather than claiming idle activity.
  it("returns null when the activity summary request fails", async () => {
    coreClientMock.getTasksSummary.mockRejectedValue(new Error("core down"));

    const { taskService } = await import("./task.service");

    await expect(
      taskService.getActivitySummary({ scope: "owned" }),
    ).resolves.toBeNull();
  });

  it("returns null when the activity summary response carries no data", async () => {
    coreClientMock.getTasksSummary.mockResolvedValue({ data: null });

    const { taskService } = await import("./task.service");

    await expect(taskService.getActivitySummary({})).resolves.toBeNull();
  });
});
