import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTransaction = vi.fn();
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskLinkCreate = vi.fn();
const mockTaskEventCreate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: mockTransaction,
    task: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockTaskCreate,
      update: mockTaskUpdate,
    },
    taskLink: {
      create: mockTaskLinkCreate,
    },
    taskEvent: {
      create: mockTaskEventCreate,
    },
  },
}));

describe("taskSchedulesSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"));
  });

  it("creates multiple clones when recurring runs were missed", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    let metadata = JSON.stringify({
      version: 1,
      mode: "recurring",
      scheduledAt: "2026-06-01T09:00:00.000Z",
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: "never",
    });

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      userId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      coworkerId: null,
      name: "Template",
      description: "Run me",
      metadata,
      nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
    });

    mockTaskCreate.mockResolvedValue({ id: "clone-1" });
    mockTaskUpdate.mockImplementation(async ({ data }) => {
      if (typeof data.metadata === "string") {
        metadata = data.metadata;
      }
      return { id: "template-1" };
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(1);
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "template-1" },
        data: expect.objectContaining({
          nextRunAt: new Date("2026-06-11T09:00:00.000Z"),
        }),
      }),
    );
  });
});
