import { beforeEach, describe, expect, it, vi } from "vitest";

import { publicShareRepository } from "./public-share.repository.js";

const upsertMock = vi.fn();
const deleteManyMock = vi.fn();

describe("publicShareRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({
      id: "share_123",
      token: "public-share-token",
      allowSearchIndexing: true,
    });
    deleteManyMock.mockResolvedValue({ count: 1 });
  });

  it("creates a share token once for jobs and preserves it on later updates", async () => {
    await publicShareRepository.upsertForJob("job_123", false, {
      publicShare: {
        upsert: upsertMock,
      },
    } as never);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "job_123" },
        create: expect.objectContaining({
          allowSearchIndexing: false,
          token: expect.any(String),
          job: { connect: { id: "job_123" } },
        }),
        update: {
          allowSearchIndexing: false,
        },
      }),
    );
  });

  it("creates a share token once for tasks and preserves it on later updates", async () => {
    await publicShareRepository.upsertForTask("task_123", false, {
      publicShare: {
        upsert: upsertMock,
      },
    } as never);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "task_123" },
        create: expect.objectContaining({
          allowSearchIndexing: false,
          token: expect.any(String),
          task: { connect: { id: "task_123" } },
        }),
        update: {
          allowSearchIndexing: false,
        },
      }),
    );
  });

  it("deletes shares by job id", async () => {
    await publicShareRepository.deleteByJobId("job_123", {
      publicShare: {
        deleteMany: deleteManyMock,
      },
    } as never);

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { jobId: "job_123" },
    });
  });

  it("deletes shares by task id", async () => {
    await publicShareRepository.deleteByTaskId("task_123", {
      publicShare: {
        deleteMany: deleteManyMock,
      },
    } as never);

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { taskId: "task_123" },
    });
  });
});
