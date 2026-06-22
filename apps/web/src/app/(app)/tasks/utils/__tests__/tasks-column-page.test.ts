import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TaskStatus } from "@sokosumi/utils";

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
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    coworkerId: null,
    description: null,
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
      coworkerId: "coworker-1",
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
      status: [TaskStatus.DRAFT],
      scope: "owned",
      coworkerId: undefined,
      projectId: undefined,
      cursor: "cursor-1",
      limit: 1,
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
});
