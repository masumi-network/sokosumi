import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TaskStatus } from "@/lib/clients/generated/core";

import { getTasksColumnPage } from "../tasks-column-page";

const listTasksMock = vi.fn();
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTasks: (...args: unknown[]) => listTasksMock(...args),
  },
}));

function buildTask({
  id,
  status,
  updatedAt,
}: {
  id: string;
  status: TaskStatus;
  updatedAt: string;
}) {
  return {
    id,
    name: `Task ${id}`,
    status,
    userId: "user-1",
    user: { id: "user-1", name: "Test User", image: null },
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    coworkerId: null,
    description: null,
    commentsCount: 0,
    jobsCount: 0,
    grantResumeStatus: null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: null,
      organization: null,
    },
    events: [],
    jobs: [],
  } as const;
}

describe("getTasksColumnPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries all column statuses in one request", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-10",
          status: TaskStatus.COMPLETED,
          updatedAt: "2026-03-01T10:00:00.000Z",
        }),
        buildTask({
          id: "task-09",
          status: TaskStatus.FAILED,
          updatedAt: "2026-03-01T09:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: "cursor-1" },
    });

    const page = await getTasksColumnPage({
      columnId: "done",
      cursor: null,
      limit: 2,
      scope: "workspace",
      coworkerId: "coworker-1",
      status: null,
      projectId: PROJECT_ID,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-10", "task-09"]);
    expect(page.nextCursor).toBe("cursor-1");
    expect(listTasksMock).toHaveBeenCalledTimes(1);
    expect(listTasksMock).toHaveBeenCalledWith({
      status: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED],
      scope: "workspace",
      assigneeId: "coworker-1",
      projectId: PROJECT_ID,
      cursor: null,
      limit: 2,
    });
  });

  it("forwards cursor to core pagination on follow-up requests", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-2",
          status: TaskStatus.DRAFT,
          updatedAt: "2026-03-02T01:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: null },
    });

    const page = await getTasksColumnPage({
      columnId: "backlog",
      cursor: "cursor-1",
      limit: 1,
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-2"]);
    expect(page.nextCursor).toBeNull();
    expect(listTasksMock).toHaveBeenCalledWith({
      status: [TaskStatus.DRAFT, TaskStatus.QUEUED],
      scope: "owned",
      assigneeId: undefined,
      projectId: undefined,
      cursor: "cursor-1",
      limit: 1,
    });
  });

  it("queries backlog column statuses in one request", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-queued",
          status: TaskStatus.QUEUED,
          updatedAt: "2026-03-02T02:00:00.000Z",
        }),
        buildTask({
          id: "task-draft",
          status: TaskStatus.DRAFT,
          updatedAt: "2026-03-02T01:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: null },
    });

    const page = await getTasksColumnPage({
      columnId: "backlog",
      cursor: null,
      limit: 10,
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.tasks.map((task) => task.id)).toEqual([
      "task-queued",
      "task-draft",
    ]);
    expect(listTasksMock).toHaveBeenCalledWith({
      status: [TaskStatus.DRAFT, TaskStatus.QUEUED],
      scope: "owned",
      assigneeId: undefined,
      projectId: undefined,
      cursor: null,
      limit: 10,
    });
  });

  it("returns null cursor when pagination metadata is missing", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-1",
          status: TaskStatus.READY,
          updatedAt: "2026-03-03T01:00:00.000Z",
        }),
      ],
      pagination: null,
    });

    const page = await getTasksColumnPage({
      columnId: "todo",
      cursor: null,
      limit: 10,
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.nextCursor).toBeNull();
  });

  it("returns an empty page when the selected status is outside the column", async () => {
    const page = await getTasksColumnPage({
      columnId: "backlog",
      cursor: null,
      limit: 10,
      scope: "workspace",
      coworkerId: null,
      status: TaskStatus.COMPLETED,
      projectId: null,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page).toEqual({
      tasks: [],
      nextCursor: null,
    });
    expect(listTasksMock).not.toHaveBeenCalled();
  });

  it("queries todo column statuses in one request", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-ready",
          status: TaskStatus.READY,
          updatedAt: "2026-03-03T02:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: null },
    });

    const page = await getTasksColumnPage({
      columnId: "todo",
      cursor: null,
      limit: 10,
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-ready"]);
    expect(listTasksMock).toHaveBeenCalledWith({
      status: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
      scope: "owned",
      assigneeId: undefined,
      projectId: undefined,
      cursor: null,
      limit: 10,
    });
  });

  it("queries input-required column statuses including GRANT_PENDING", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-grant-pending",
          status: TaskStatus.GRANT_PENDING,
          updatedAt: "2026-03-03T01:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: null },
    });

    const page = await getTasksColumnPage({
      columnId: "input-required",
      cursor: null,
      limit: 10,
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-grant-pending"]);
    expect(listTasksMock).toHaveBeenCalledWith({
      status: [
        TaskStatus.GRANT_PENDING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.APPROVAL_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.OUT_OF_CREDITS,
      ],
      scope: "owned",
      assigneeId: undefined,
      projectId: undefined,
      cursor: null,
      limit: 10,
    });
  });
});
