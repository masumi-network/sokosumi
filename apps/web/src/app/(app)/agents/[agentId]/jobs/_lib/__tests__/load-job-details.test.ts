import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getAgentByIdMock = vi.fn();
const getJobByIdMock = vi.fn();
const { resolveWorkspaceForContextMock } = vi.hoisted(() => ({
  resolveWorkspaceForContextMock: vi.fn(),
}));
const setQueryDataMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("@/lib/auth/utils", () => ({
  getSession: getSessionMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  agentRepository: {
    getAgentWithRelationsById: getAgentByIdMock,
  },
  jobRepository: {
    getJobById: getJobByIdMock,
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  resolveWorkspaceForContext: resolveWorkspaceForContextMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
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
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "workspace-1",
    });
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
      organizationId: null,
      workspaceId: "workspace-2",
    });

    const { loadJobDetails } = await import("../load-job-details");

    await expect(
      loadJobDetails({ agentId: "agent-1", jobId: "job-1" }),
    ).rejects.toThrow("redirect:/agents/agent-1/jobs");

    expect(redirectMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
  });

  it("allows org-scoped jobs from other members in read-only mode", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ id: "agent-1" });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "other-user",
      organizationId: "org-1",
      workspaceId: "workspace-1",
    });

    const { loadJobDetails } = await import("../load-job-details");
    const result = await loadJobDetails({ agentId: "agent-1", jobId: "job-1" });

    expect(result).toMatchObject({
      job: {
        id: "job-1",
      },
      readOnly: true,
      activeOrganizationId: "org-1",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects when the org matches but the active workspace does not", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ id: "agent-1" });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "other-user",
      organizationId: "org-1",
      workspaceId: "workspace-2",
    });

    const { loadJobDetails } = await import("../load-job-details");

    await expect(
      loadJobDetails({ agentId: "agent-1", jobId: "job-1" }),
    ).rejects.toThrow("redirect:/agents/agent-1/jobs");

    expect(redirectMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
  });

  it("redirects when the workspace matches but the job belongs to another organization", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getAgentByIdMock.mockResolvedValue({ id: "agent-1" });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "other-user",
      organizationId: "org-2",
      workspaceId: "workspace-1",
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
      organizationId: "org-1",
      workspaceId: "workspace-2",
    });

    const { loadJobDetails } = await import("../load-job-details");
    const result = await loadJobDetails({ agentId: "agent-1", jobId: "job-1" });

    expect(setQueryDataMock).toHaveBeenCalledWith(["jobs", "job-1"], {
      id: "job-1",
      agent: { id: "agent-1" },
      userId: "user-1",
      organizationId: "org-1",
      workspaceId: "workspace-2",
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
});
