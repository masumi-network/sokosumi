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

  it("returns the first page only and does not walk nextCursor", async () => {
    getAgentJobsMock.mockResolvedValueOnce({
      data: [
        { id: "job-newest", createdAt: "2024-01-03T00:00:00.000Z" },
        { id: "job-middle", createdAt: "2024-01-02T00:00:00.000Z" },
      ],
      meta: {
        pagination: {
          nextCursor: "cursor-2",
        },
      },
    });

    const { getCachedMyJobs } = await import("./get-cached-my-jobs");
    const page = await getCachedMyJobs("agent-1");

    expect(getAgentJobsMock).toHaveBeenCalledTimes(1);
    expect(getAgentJobsMock).toHaveBeenCalledWith("agent-1", {
      limit: 20,
      scope: "owned",
    });
    expect(page.jobs.map((job: { id: string }) => job.id)).toEqual([
      "job-newest",
      "job-middle",
    ]);
    expect(page.nextCursor).toBe("cursor-2");
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

    const { getCachedMyJobs } = await import("./get-cached-my-jobs");
    const page = await getCachedMyJobs("agent-1");

    expect(page.jobs).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(getAgentJobsMock).toHaveBeenCalledTimes(1);
  });
});

describe("getOwnedAgentJobsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("passes cursor for load-more", async () => {
    getAgentJobsMock.mockResolvedValueOnce({
      data: [{ id: "job-older", createdAt: "2024-01-01T00:00:00.000Z" }],
      meta: {
        pagination: {
          nextCursor: null,
        },
      },
    });

    const { getOwnedAgentJobsPage } = await import("./get-cached-my-jobs");
    const page = await getOwnedAgentJobsPage("agent-1", "cursor-2");

    expect(getAgentJobsMock).toHaveBeenCalledWith("agent-1", {
      cursor: "cursor-2",
      limit: 20,
      scope: "owned",
    });
    expect(page.jobs.map((job: { id: string }) => job.id)).toEqual([
      "job-older",
    ]);
    expect(page.nextCursor).toBeNull();
  });
});
