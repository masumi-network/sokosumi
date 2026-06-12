import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listAdminTasksMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    listAdminTasks: (...args: unknown[]) => listAdminTasksMock(...args),
  },
  CoreApiRequestError: class extends Error {},
}));

import { adminTaskService } from "../admin-task.service";

describe("adminTaskService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps task rows and pagination", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    listAdminTasksMock.mockResolvedValue({
      data: [
        {
          id: "task_1",
          name: "Quarterly report",
          status: "RUNNING",
          createdAt,
          user: {
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

    const result = await adminTaskService.listTasks({ query: "acme" });

    expect(listAdminTasksMock).toHaveBeenCalledWith({ query: "acme" });
    expect(result.tasks).toEqual([
      {
        id: "task_1",
        name: "Quarterly report",
        status: "RUNNING",
        createdAt,
        user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it("passes cursor and limit through and surfaces nextCursor", async () => {
    listAdminTasksMock.mockResolvedValue({
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

    const result = await adminTaskService.listTasks({
      cursor: "task_0",
      limit: 10,
    });

    expect(listAdminTasksMock).toHaveBeenCalledWith({
      cursor: "task_0",
      limit: 10,
    });
    expect(result.nextCursor).toBe("task_9");
    expect(result.total).toBe(25);
  });
});
