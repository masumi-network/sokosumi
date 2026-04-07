import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getJobsMock = vi.fn();
const getOwnedJobsMock = vi.fn();
const resolveWorkspaceForContextMock = vi.fn();

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getJobs: (...args: unknown[]) => getJobsMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    mapJobWithStatus: (job: unknown) => job,
    resolveWorkspaceForContext: (...args: unknown[]) =>
      resolveWorkspaceForContextMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  invitationRepository: {},
  jobRepository: {
    getJobs: (...args: unknown[]) => getOwnedJobsMock(...args),
  },
  memberRepository: {},
  organizationRepository: {},
  userRepository: {},
}));

describe("user.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
  });

  it("returns workspace jobs for the active organization context", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getOwnedJobsMock.mockResolvedValue([
      { id: "job-2", createdAt: new Date("2026-02-13T10:00:00.000Z") },
      { id: "job-1", createdAt: new Date("2026-02-12T10:00:00.000Z") },
    ]);

    const { userService } = await import("../user.service");
    const result = await userService.getMyJobs("agent-1");

    expect(getOwnedJobsMock).toHaveBeenCalledTimes(1);
    expect(getOwnedJobsMock).toHaveBeenCalledWith(
      {
        agentId: "agent-1",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      expect.any(Object),
    );
    expect(result.map((job) => job.id)).toEqual(["job-2", "job-1"]);
  });

  it("keeps personal workspace jobs owner-scoped", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: null },
    });
    getOwnedJobsMock.mockResolvedValue([
      { id: "job-1", createdAt: new Date("2026-02-12T10:00:00.000Z") },
    ]);

    const { userService } = await import("../user.service");
    const result = await userService.getMyJobs("agent-1");

    expect(getOwnedJobsMock).toHaveBeenCalledTimes(1);
    expect(getOwnedJobsMock).toHaveBeenCalledWith(
      {
        agentId: "agent-1",
        userId: "user-1",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      expect.any(Object),
    );
    expect(result.map((job) => job.id)).toEqual(["job-1"]);
  });

  it("queries paginated jobs without organization-share fallback", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getJobsMock.mockResolvedValue({
      data: [
        {
          id: "job-1",
          agentId: "agent-1",
          userId: "user-1",
          name: "Job 1",
          jobType: "FREE",
          status: "COMPLETED",
          createdAt: "2026-02-13T10:00:00.000Z",
          updatedAt: "2026-02-13T10:00:00.000Z",
          completedAt: "2026-02-13T10:01:00.000Z",
        },
      ],
      meta: {
        pagination: {
          nextCursor: "cursor-2",
        },
      },
    });

    const { userService } = await import("../user.service");
    const result = await userService.listMyJobsForActiveContextPaginated({
      limit: 20,
      memberId: "user-2",
      agentId: "agent-1",
      status: "COMPLETED",
    });

    expect(getJobsMock).toHaveBeenCalledWith({
      limit: 20,
      memberId: "user-2",
      agentId: "agent-1",
      status: "COMPLETED",
    });
    expect(result).toEqual({
      jobs: [
        expect.objectContaining({
          id: "job-1",
        }),
      ],
      nextCursor: "cursor-2",
    });
  });
});
