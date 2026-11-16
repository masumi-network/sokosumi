import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TaskStatus } from "@sokosumi/core-client";

import { getTasksListPage } from "./tasks-list-page";

const listTasksMock = vi.fn();
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTasks: (...args: unknown[]) => listTasksMock(...args),
  },
}));

vi.mock("@/app/tasks/utils/mentioned-agents", () => ({
  resolveMentionedAgentsById: vi.fn().mockResolvedValue(new Map()),
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
    ownerId: "user-1",
    owner: { id: "user-1", name: "Test User", image: null },
    // Deprecated aliases — keep until clients migrate.
    userId: "user-1",
    user: { id: "user-1", name: "Test User", image: null },
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    participants: [],
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

describe("getTasksListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries listTasks without a status array when status is null", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-10",
          status: TaskStatus.COMPLETED,
          updatedAt: "2026-03-01T10:00:00.000Z",
        }),
        buildTask({
          id: "task-09",
          status: TaskStatus.READY,
          updatedAt: "2026-03-01T09:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: "cursor-1" },
    });

    const page = await getTasksListPage({
      cursor: null,
      limit: 2,
      scope: "workspace",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: PROJECT_ID,
      visibility: null,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-10", "task-09"]);
    expect(page.nextCursor).toBe("cursor-1");
    expect(listTasksMock).toHaveBeenCalledTimes(1);
    expect(listTasksMock).toHaveBeenCalledWith({
      status: undefined,
      scope: "workspace",
      assigneeId: "coworker-1",
      assigneeSokoBotId: undefined,
      assigneeUserId: undefined,
      projectId: PROJECT_ID,
      cursor: null,
      limit: 2,
    });
  });

  it("queries listTasks with a single status when filtered", async () => {
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

    const page = await getTasksListPage({
      cursor: null,
      limit: 10,
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.READY,
      projectId: null,
      visibility: null,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-ready"]);
    expect(page.nextCursor).toBeNull();
    expect(listTasksMock).toHaveBeenCalledWith({
      status: TaskStatus.READY,
      scope: "owned",
      assigneeId: undefined,
      assigneeSokoBotId: undefined,
      assigneeUserId: undefined,
      projectId: undefined,
      cursor: null,
      limit: 10,
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

    const page = await getTasksListPage({
      cursor: "cursor-1",
      limit: 1,
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });

    expect(page.tasks.map((task) => task.id)).toEqual(["task-2"]);
    expect(page.nextCursor).toBeNull();
    expect(listTasksMock).toHaveBeenCalledWith({
      status: undefined,
      scope: "owned",
      assigneeId: undefined,
      assigneeSokoBotId: undefined,
      assigneeUserId: undefined,
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

    const page = await getTasksListPage({
      cursor: null,
      limit: 10,
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });

    expect(page.nextCursor).toBeNull();
  });

  it("forwards a user assignee filter to listTasks (SOK-868)", async () => {
    listTasksMock.mockResolvedValue({ tasks: [], pagination: null });

    await getTasksListPage({
      cursor: null,
      limit: 10,
      scope: "workspace",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: "user-1",
      status: null,
      projectId: null,
      visibility: null,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });

    expect(listTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeUserId: "user-1" }),
    );
  });

  it("lists only waiting statuses unchanged for three days under Stuck", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-14T12:00:00.000Z") });
    listTasksMock.mockResolvedValue({ tasks: [], pagination: null });

    await getTasksListPage({
      cursor: null,
      limit: 10,
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
      stuck: true,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });
    vi.useRealTimers();

    const params = listTasksMock.mock.calls[0]?.[0];
    expect(params.statusBefore).toEqual(new Date("2026-11-11T12:00:00.000Z"));
    expect(params.status).toContain(TaskStatus.INPUT_REQUIRED);
    expect(params.status).not.toContain(TaskStatus.DRAFT);
    expect(params.status).not.toContain(TaskStatus.COMPLETED);
  });

  it("lists nothing under Stuck for a status that cannot wait", async () => {
    const page = await getTasksListPage({
      cursor: null,
      limit: 10,
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.COMPLETED,
      projectId: null,
      visibility: null,
      stuck: true,
      coworkersById: new Map(),
      personalAssistantFallback: "Personal assistant",
    });

    expect(page).toEqual({ tasks: [], nextCursor: null });
    expect(listTasksMock).not.toHaveBeenCalled();
  });
});
