import { beforeEach, describe, expect, it, vi } from "vitest";

const getAgentJobsMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getAgentJobs: (...args: unknown[]) => getAgentJobsMock(...args),
  },
}));

describe("getCachedMyJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("walks all pages and returns jobs sorted by newest first", async () => {
    getAgentJobsMock
      .mockResolvedValueOnce({
        data: [
          { id: "job-older", createdAt: "2024-01-01T00:00:00.000Z" },
          { id: "job-middle", createdAt: "2024-01-02T00:00:00.000Z" },
        ],
        meta: {
          pagination: {
            nextCursor: "cursor-2",
          },
        },
      })
      .mockResolvedValueOnce({
        data: [{ id: "job-newest", createdAt: "2024-01-03T00:00:00.000Z" }],
        meta: {
          pagination: {
            nextCursor: null,
          },
        },
      });

    const { getCachedMyJobs } = await import("../get-cached-my-jobs");
    const jobs = await getCachedMyJobs("agent-1");

    expect(getAgentJobsMock).toHaveBeenNthCalledWith(1, "agent-1", {
      cursor: undefined,
      limit: 100,
      scope: "owned",
    });
    expect(getAgentJobsMock).toHaveBeenNthCalledWith(2, "agent-1", {
      cursor: "cursor-2",
      limit: 100,
      scope: "owned",
    });
    expect(jobs.map((job: { id: string }) => job.id)).toEqual([
      "job-newest",
      "job-middle",
      "job-older",
    ]);
  });

  it("returns an empty list when the first page is empty", async () => {
    getAgentJobsMock.mockResolvedValue({
      data: [],
      meta: {
        pagination: {
          nextCursor: null,
        },
      },
    });

    const { getCachedMyJobs } = await import("../get-cached-my-jobs");
    const jobs = await getCachedMyJobs("agent-1");

    expect(jobs).toEqual([]);
    expect(getAgentJobsMock).toHaveBeenCalledTimes(1);
  });
});
