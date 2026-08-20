import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveTasksListItem } from "@/lib/clients/generated/core";
import {
  DRIVE_TASKS_MAX_PAGES,
  DRIVE_TASKS_PAGE_LIMIT,
  listDriveTasks,
} from "../drive-tasks-list.client";

const getDriveTasksMock = vi.fn();

vi.mock("@/lib/clients/generated/core", () => ({
  getDriveTasks: (...args: unknown[]) => getDriveTasksMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

describe("listDriveTasks", () => {
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

    const result = await listDriveTasks({ scope: "me" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "task-project",
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

    const result = await listDriveTasks({
      scope: "org",
      organizationId: "org-123",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
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

    await listDriveTasks({
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

    await listDriveTasks({
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

    await listDriveTasks({
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

  it("handles pagination with cursor", async () => {
    const page1Items: DriveTasksListItem[] = [
      {
        type: "project",
        id: "proj-1",
        name: "Project 1",
        latestFileUpdatedAt: new Date("2026-01-01"),
      },
    ];
    const page2Items: DriveTasksListItem[] = [
      {
        type: "project",
        id: "proj-2",
        name: "Project 2",
        latestFileUpdatedAt: new Date("2026-01-02"),
      },
    ];

    getDriveTasksMock
      .mockResolvedValueOnce({
        data: {
          data: page1Items,
          meta: { pagination: { nextCursor: "cursor-1" } },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: page2Items,
          meta: { pagination: { nextCursor: null } },
        },
      });

    const result = await listDriveTasks({ scope: "me" });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("proj-1");
    expect(result[1].id).toBe("proj-2");
    expect(getDriveTasksMock).toHaveBeenCalledTimes(2);
    expect(getDriveTasksMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: expect.objectContaining({
          cursor: "cursor-1",
        }),
      }),
    );
  });

  it("stops after max pages", async () => {
    const mockItem: DriveTasksListItem = {
      type: "project",
      id: "proj-1",
      name: "Project 1",
      latestFileUpdatedAt: new Date("2026-01-01"),
    };

    getDriveTasksMock.mockResolvedValue({
      data: {
        data: [mockItem],
        meta: { pagination: { nextCursor: "always-has-next" } },
      },
    });

    const result = await listDriveTasks({ scope: "me" });

    expect(getDriveTasksMock).toHaveBeenCalledTimes(DRIVE_TASKS_MAX_PAGES);
    expect(result).toHaveLength(DRIVE_TASKS_MAX_PAGES);
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

    const result = await listDriveTasks({ scope: "me" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
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

    const result = await listDriveTasks({ scope: "me" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "task-no-project",
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

    await listDriveTasks({
      scope: "me",
      signal: controller.signal,
    });

    expect(getDriveTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });
});
