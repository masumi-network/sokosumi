import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  listDeveloperOwnedCoworkerTasksMock,
  getDeveloperOwnedCoworkerTaskMock,
  MockCoreApiRequestError,
} = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    listDeveloperOwnedCoworkerTasksMock: vi.fn(),
    getDeveloperOwnedCoworkerTaskMock: vi.fn(),
    MockCoreApiRequestError,
  };
});

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    listDeveloperOwnedCoworkerTasks: (...args: unknown[]) =>
      listDeveloperOwnedCoworkerTasksMock(...args),
    getDeveloperOwnedCoworkerTask: (...args: unknown[]) =>
      getDeveloperOwnedCoworkerTaskMock(...args),
  },
  CoreApiRequestError: MockCoreApiRequestError,
}));

import { developerTaskService } from "./developer-task.service";

describe("developerTaskService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps task rows and pagination", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const updatedAt = new Date("2025-01-02T00:00:00.000Z");
    listDeveloperOwnedCoworkerTasksMock.mockResolvedValue({
      data: [
        {
          id: "task_1",
          name: "Quarterly report",
          status: "RUNNING",
          createdAt,
          updatedAt,
          assignee: { id: "cow_1", name: "Elena", slug: "elena" },
          creatorCoworker: null,
          owner: {
            id: "user_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
          organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
        },
      ],
      meta: {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        requestId: "req_1",
        pagination: { cursor: null, limit: 20, total: 1, nextCursor: null },
      },
    });

    const result = await developerTaskService.listTasks();

    expect(listDeveloperOwnedCoworkerTasksMock).toHaveBeenCalledWith({});
    expect(result.tasks).toEqual([
      {
        id: "task_1",
        name: "Quarterly report",
        status: "RUNNING",
        createdAt,
        updatedAt,
        assignee: { id: "cow_1", name: "Elena", slug: "elena" },
        creatorCoworker: null,
        owner: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it("passes cursor and limit through and surfaces nextCursor", async () => {
    listDeveloperOwnedCoworkerTasksMock.mockResolvedValue({
      data: [],
      meta: {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        requestId: "req_2",
        pagination: {
          cursor: "task_0",
          limit: 10,
          total: 25,
          nextCursor: "task_9",
        },
      },
    });

    const result = await developerTaskService.listTasks({
      cursor: "task_0",
      limit: 10,
    });

    expect(listDeveloperOwnedCoworkerTasksMock).toHaveBeenCalledWith({
      cursor: "task_0",
      limit: 10,
    });
    expect(result.nextCursor).toBe("task_9");
    expect(result.total).toBe(25);
  });

  it("returns the full task detail by id", async () => {
    const task = {
      id: "task_1",
      name: "Quarterly report",
      status: "RUNNING",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      jobs: [],
      events: [],
      links: [],
    };
    getDeveloperOwnedCoworkerTaskMock.mockResolvedValue({
      data: {
        task,
        owner: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
      },
    });

    const result = await developerTaskService.getTask("task_1");

    expect(getDeveloperOwnedCoworkerTaskMock).toHaveBeenCalledWith("task_1");
    expect(result).toEqual({
      task,
      owner: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
      organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
    });
  });

  it("returns null when the task does not exist", async () => {
    getDeveloperOwnedCoworkerTaskMock.mockRejectedValue(
      new MockCoreApiRequestError("Task not found", 404),
    );

    await expect(
      developerTaskService.getTask("task_missing"),
    ).resolves.toBeNull();
  });

  it("rethrows non-404 errors from getTask", async () => {
    getDeveloperOwnedCoworkerTaskMock.mockRejectedValue(
      new MockCoreApiRequestError("Forbidden", 403),
    );

    await expect(developerTaskService.getTask("task_1")).rejects.toThrow(
      "Forbidden",
    );
  });
});
