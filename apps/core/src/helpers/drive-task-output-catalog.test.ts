import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaTaskFileFindFirstMock = vi.hoisted(() => vi.fn());
const prismaTaskFileFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findFirst: prismaTaskFileFindFirstMock,
      findMany: prismaTaskFileFindManyMock,
    },
  },
}));

import { fetchDriveTaskOutputRecentsBatch } from "@/helpers/drive-task-output-catalog";

describe("fetchDriveTaskOutputRecentsBatch", () => {
  beforeEach(() => {
    prismaTaskFileFindFirstMock.mockReset();
    prismaTaskFileFindManyMock.mockReset();
  });

  it("restarts from the beginning when the task cursor is stale", async () => {
    prismaTaskFileFindFirstMock.mockResolvedValue(null);
    prismaTaskFileFindManyMock.mockResolvedValue([
      {
        id: "tf-1",
        name: "output.pdf",
        fileUrl: "https://example.com/output.pdf",
        size: BigInt(100),
        updatedAt: new Date("2026-08-21T12:00:00.000Z"),
        task: {
          id: "task-1",
          name: "Task",
          projectId: null,
          project: null,
        },
      },
    ]);

    const page = await fetchDriveTaskOutputRecentsBatch({
      baseTaskWhere: { workspaceId: "ws_1" },
      cursor: "deleted-task-file",
      take: 10,
    });

    expect(prismaTaskFileFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: undefined,
        skip: undefined,
      }),
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.id).toBe("tf-1");
    expect(page.hasMore).toBe(false);
  });
});
