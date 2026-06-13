import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getAgentByIdMock = vi.fn();
const getJobByIdMock = vi.fn();
const setQueryDataMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

class MockCoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    getAgentById: (...args: unknown[]) => getAgentByIdMock(...args),
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  },
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@tanstack/react-query", () => ({
  dehydrate: vi.fn(() => "dehydrated-state"),
}));

vi.mock("@/queries", () => ({
  getJobQueryKey: (jobId: string) => ["jobs", jobId],
  getQueryClient: () => ({
    setQueryData: setQueryDataMock,
  }),
}));

describe("loadJobDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns workspace-visible jobs in read-only mode", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Ada Lovelace" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ data: { id: "agent-1" } });
    getJobByIdMock.mockResolvedValue({
      data: {
        id: "job-1",
        agent: { id: "agent-1" },
        userId: "other-user",
      },
    });

    const { loadJobDetails } = await import("../load-job-details");
    const result = await loadJobDetails({ agentId: "agent-1", jobId: "job-1" });

    expect(setQueryDataMock).toHaveBeenCalledWith(["jobs", "job-1"], {
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "other-user",
    });
    expect(result).toMatchObject({
      job: {
        id: "job-1",
      },
      readOnly: true,
      activeOrganizationId: "org-1",
      dehydratedState: "dehydrated-state",
      personalWorkspaceLabel: "Ada Lovelace",
    });
  });

  it("returns owned jobs without read-only mode", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ data: { id: "agent-1" } });
    getJobByIdMock.mockResolvedValue({
      data: {
        id: "job-1",
        agent: { id: "agent-1" },
        userId: "user-1",
      },
    });

    const { loadJobDetails } = await import("../load-job-details");
    const result = await loadJobDetails({ agentId: "agent-1", jobId: "job-1" });

    expect(setQueryDataMock).toHaveBeenCalledWith(["jobs", "job-1"], {
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "user-1",
    });
    expect(result).toMatchObject({
      job: {
        id: "job-1",
      },
      readOnly: false,
      activeOrganizationId: "org-1",
      dehydratedState: "dehydrated-state",
      personalWorkspaceLabel: null,
    });
  });

  it("calls notFound when core reports a missing job", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ data: { id: "agent-1" } });
    getJobByIdMock.mockRejectedValue(
      new MockCoreApiRequestError("Job not found", { status: 404 }),
    );

    const { loadJobDetails } = await import("../load-job-details");

    await expect(
      loadJobDetails({ agentId: "agent-1", jobId: "job-1" }),
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
