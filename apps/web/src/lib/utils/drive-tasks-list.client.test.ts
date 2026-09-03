import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveTasksListItem } from "@/lib/clients/generated/core";
import {
  DRIVE_TASKS_PAGE_LIMIT,
  fetchDriveTasksPage,
} from "./drive-tasks-list.client";

const getDriveTasksMock = vi.fn();

vi.mock("@/lib/clients/generated/core", () => ({
  getDriveTasks: (...args: unknown[]) => getDriveTasksMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

describe("fetchDriveTasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tasks for me scope without organizationId", async () => {
    const mockItems: DriveTasksListItem[] = [
      {
        type: "project",
        id: "proj-1",
        name: "Project 1",
        latestFileUpdatedAt: new Date("2026-01-01"),
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: mockItems,
        meta: { pagination: { nextCursor: null } },
      },
    });

    const result = await fetchDriveTasksPage({ scope: "me" });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(result.items[0]).toMatchObject({
      type: "project",
      id: "proj-1",
      name: "Project 1",
    });
    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          scope: "me",
          limit: DRIVE_TASKS_PAGE_LIMIT,
        }),
      }),
    );
    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        query: expect.objectContaining({
          organizationId: expect.anything(),
        }),
      }),
    );
  });

  it("fetches tasks for org scope with organizationId", async () => {
    const mockItems: DriveTasksListItem[] = [
      {
        type: "task",
        id: "task-1",
        name: "Task 1",
        latestFileUpdatedAt: new Date("2026-01-01"),
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: mockItems,
        meta: { pagination: { nextCursor: null } },
      },
    });

    const result = await fetchDriveTasksPage({
      scope: "org",
      organizationId: "org-123",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "task",
      id: "task-1",
      name: "Task 1",
    });
    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          scope: "org",
          organizationId: "org-123",
          limit: DRIVE_TASKS_PAGE_LIMIT,
        }),
      }),
    );
  });

  it("passes projectId filter to query", async () => {
    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({
      scope: "me",
      projectId: "proj-456",
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: "proj-456",
        }),
      }),
    );
  });

  it("passes taskId filter to query", async () => {
    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({
      scope: "me",
      taskId: "task-789",
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          taskId: "task-789",
        }),
      }),
    );
  });

  it("passes assigneeId filter to query", async () => {
    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({
      scope: "me",
      assigneeId: "cow-123",
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          assigneeId: "cow-123",
        }),
      }),
    );
  });

  it("passes q search filter to query", async () => {
    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({
      scope: "me",
      q: "mockup",
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          q: "mockup",
        }),
      }),
    );
  });

  it("returns one page and nextCursor without auto-fetching", async () => {
    const page1Items: DriveTasksListItem[] = [
      {
        type: "project",
        id: "proj-1",
        name: "Project 1",
        latestFileUpdatedAt: new Date("2026-01-01"),
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: page1Items,
        meta: { pagination: { nextCursor: "cursor-1" } },
      },
    });

    const result = await fetchDriveTasksPage({ scope: "me" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("proj-1");
    expect(result.nextCursor).toBe("cursor-1");
    expect(getDriveTasksMock).toHaveBeenCalledTimes(1);
  });

  it("passes cursor for subsequent pages", async () => {
    const page2Items: DriveTasksListItem[] = [
      {
        type: "project",
        id: "proj-2",
        name: "Project 2",
        latestFileUpdatedAt: new Date("2026-01-02"),
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: page2Items,
        meta: { pagination: { nextCursor: null } },
      },
    });

    const result = await fetchDriveTasksPage({
      scope: "me",
      cursor: "cursor-1",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("proj-2");
    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          cursor: "cursor-1",
        }),
      }),
    );
  });

  it("clears repeated nextCursor values", async () => {
    const mockItem: DriveTasksListItem = {
      type: "project",
      id: "proj-1",
      name: "Project 1",
      latestFileUpdatedAt: new Date("2026-01-01"),
    };

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [mockItem],
        meta: { pagination: { nextCursor: "cursor-1" } },
      },
    });

    const result = await fetchDriveTasksPage({
      scope: "me",
      cursor: "cursor-1",
    });

    expect(result.nextCursor).toBeNull();
  });

  it("maps task-file items correctly", async () => {
    const mockItems: DriveTasksListItem[] = [
      {
        type: "task-file",
        id: "file-1",
        name: "output.txt",
        fileUrl: "https://example.com/file.txt",
        size: 1024,
        mimeType: "text/plain",
        updatedAt: new Date("2026-01-15"),
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: mockItems,
        meta: { pagination: { nextCursor: null } },
      },
    });

    const result = await fetchDriveTasksPage({ scope: "me" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "task-file",
      id: "file-1",
      name: "output.txt",
      fileUrl: "https://example.com/file.txt",
      size: 1024,
      mimeType: "text/plain",
    });
  });

  it("maps no-project items correctly", async () => {
    const mockItems: DriveTasksListItem[] = [
      {
        type: "no-project",
        id: "null",
        latestFileUpdatedAt: new Date("2026-01-10"),
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: mockItems,
        meta: { pagination: { nextCursor: null } },
      },
    });

    const result = await fetchDriveTasksPage({ scope: "me" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "no-project",
      id: "null",
    });
  });

  it("passes abort signal to getDriveTasks", async () => {
    const controller = new AbortController();

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({
      scope: "me",
      signal: controller.signal,
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("handles string dates from Core runtime JSON", async () => {
    const mockItems = [
      {
        type: "project",
        id: "proj-1",
        name: "Project 1",
        latestFileUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "task",
        id: "task-1",
        name: "Task 1",
        latestFileUpdatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        type: "task-file",
        id: "file-1",
        name: "output.txt",
        fileUrl: "https://example.com/file.txt",
        size: 1024,
        mimeType: "text/plain",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        type: "no-project",
        id: "null",
        latestFileUpdatedAt: "2026-01-04T00:00:00.000Z",
      },
    ];

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: mockItems,
        meta: { pagination: { nextCursor: null } },
      },
    });

    const result = await fetchDriveTasksPage({ scope: "me" });

    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toMatchObject({
      type: "project",
      latestFileUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.items[1]).toMatchObject({
      type: "task",
      latestFileUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(result.items[2]).toMatchObject({
      type: "task-file",
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(result.items[3]).toMatchObject({
      type: "no-project",
      latestFileUpdatedAt: new Date("2026-01-04T00:00:00.000Z"),
    });
  });

  it("passes sortBy and sortOrder when set", async () => {
    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({
      scope: "me",
      sortBy: "name",
      sortOrder: "asc",
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          scope: "me",
          sortBy: "name",
          sortOrder: "asc",
        }),
      }),
    );
  });

  it("omits sort params when unset (server default)", async () => {
    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [],
        meta: { pagination: { nextCursor: null } },
      },
    });

    await fetchDriveTasksPage({ scope: "me" });

    const call = getDriveTasksMock.mock.calls[0]?.[0] as {
      query: Record<string, unknown>;
    };
    expect(call.query).not.toHaveProperty("sortBy");
    expect(call.query).not.toHaveProperty("sortOrder");
  });
});
