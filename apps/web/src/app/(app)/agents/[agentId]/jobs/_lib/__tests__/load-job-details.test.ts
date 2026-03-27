import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getAgentByIdMock = vi.fn();
const getJobByIdMock = vi.fn();
const setQueryDataMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  agentRepository: {
    getAgentWithRelationsById: (...args: unknown[]) =>
      getAgentByIdMock(...args),
  },
  jobRepository: {
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => notFoundMock(...args),
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  dehydrate: vi.fn(() => "dehydrated-state"),
}));

vi.mock("@/queries", () => ({
  getJobQueryKey: (jobId: string) => ["jobs", jobId],
  getQueryClient: () => ({
    setQueryData: (...args: unknown[]) => setQueryDataMock(...args),
  }),
}));

describe("loadJobDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("redirects when the job is not owned by the current user", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ id: "agent-1" });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "other-user",
    });

    const { loadJobDetails } = await import("../load-job-details");

    await expect(
      loadJobDetails({ agentId: "agent-1", jobId: "job-1" }),
    ).rejects.toThrow("redirect:/agents/agent-1/jobs");

    expect(redirectMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
  });

  it("returns owned jobs without read-only mode", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ id: "agent-1" });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "user-1",
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
    });
  });
});
