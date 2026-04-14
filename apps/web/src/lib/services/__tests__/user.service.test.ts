import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getJobsMock = vi.fn();
const findManyMock = vi.fn();
const findUniqueMock = vi.fn();
const upsertWorkspaceForContextMock = vi.fn();

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

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    mapJobWithStatus: (job: unknown) => job,
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  invitationRepository: {},
  jobRepository: {
    getJobs: (...args: unknown[]) => getJobsMock(...args),
  },
  memberRepository: {},
  organizationRepository: {},
  userRepository: {},
  workspaceRepository: {
    upsertWorkspaceForContext: (...args: unknown[]) =>
      upsertWorkspaceForContextMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    job: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

describe("user.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
  });

  it("returns only owned jobs for the active context", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    getJobsMock.mockResolvedValue([
      { id: "job-2", createdAt: new Date("2026-02-13T10:00:00.000Z") },
      { id: "job-1", createdAt: new Date("2026-02-12T10:00:00.000Z") },
    ]);

    const { userService } = await import("../user.service");
    const result = await userService.getMyJobs("agent-1");

    expect(getJobsMock).toHaveBeenCalledTimes(1);
    expect(getJobsMock).toHaveBeenCalledWith(
      {
        agentId: "agent-1",
        userId: "user-1",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      expect.any(Object),
    );
    expect(result.map((job) => job.id)).toEqual(["job-2", "job-1"]);
  });

  it("queries paginated jobs without organization-share fallback", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    findManyMock.mockResolvedValue([
      { id: "job-1", createdAt: new Date("2026-02-13T10:00:00.000Z") },
    ]);

    const { userService } = await import("../user.service");
    await userService.listMyJobsForActiveContextPaginated({ limit: 20 });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              userId: "user-1",
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          ],
        },
        take: 21,
      }),
    );
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
