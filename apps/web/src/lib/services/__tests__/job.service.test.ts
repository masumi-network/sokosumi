import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const moveJobToWorkspaceCoreMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    moveJobToWorkspace: (...args: unknown[]) =>
      moveJobToWorkspaceCoreMock(...args),
  },
}));

describe("jobService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves standalone jobs through the core client", async () => {
    moveJobToWorkspaceCoreMock.mockResolvedValue({
      data: {
        id: "job_123",
      },
    });

    const { jobService } = await import("../job.service");

    const result = await jobService.moveJobToWorkspace("job_123", "org_456");

    expect(moveJobToWorkspaceCoreMock).toHaveBeenCalledWith("job_123", {
      organizationId: "org_456",
    });
    expect(result).toEqual({
      id: "job_123",
    });
  });
});
