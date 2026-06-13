import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnAuthenticatedError } from "@/lib/auth/errors";

const getSessionMock = vi.fn();

const projectServiceMock = {
  listProjects: vi.fn(),
};

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (
        params: TParams & {
          session: NonNullable<Awaited<ReturnType<typeof getSessionMock>>>;
        },
      ) => Promise<TResult>,
    ) =>
    async (params: TParams) => {
      const session = await getSessionMock();
      if (!session) {
        throw new UnAuthenticatedError();
      }

      return handler({ ...params, session });
    },
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

function buildProject(overrides?: Partial<{ id: string; name: string }>) {
  return {
    id: "project-1",
    workspaceId: "workspace-1",
    name: "Launch plan",
    description: null,
    createdAt: "2026-05-27T10:00:00.000Z",
    updatedAt: "2026-05-27T10:00:00.000Z",
    taskCount: 0,
    jobCount: 0,
    ...overrides,
  };
}

describe("loadMoreProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
  });

  it("loads the next projects page with embedded counts", async () => {
    const projects = [
      buildProject(),
      buildProject({ id: "project-2", name: "Redesign" }),
    ];

    projectServiceMock.listProjects.mockResolvedValue({
      projects,
      pagination: {
        cursor: "project-0",
        limit: 20,
        nextCursor: "project-3",
        total: 3,
      },
    });

    const { loadMoreProjects } = await import("../actions");
    const result = await loadMoreProjects({ cursor: "project-0" });

    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      cursor: "project-0",
      limit: 20,
    });
    expect(result).toEqual({
      projects,
      nextCursor: "project-3",
    });
  });

  it("rejects unauthenticated callers before loading projects", async () => {
    getSessionMock.mockResolvedValue(null);

    const { loadMoreProjects } = await import("../actions");

    await expect(loadMoreProjects({ cursor: "project-0" })).rejects.toThrow(
      UnAuthenticatedError,
    );
    expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
  });
});
