import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnAuthenticatedError } from "@/lib/auth/errors";

const getSessionMock = vi.fn();

const projectServiceMock = {
  getProjectsStats: vi.fn(),
  listProjects: vi.fn(),
};

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
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

  it("loads the next projects page and returns stats keyed by project id", async () => {
    const projects = [
      buildProject(),
      buildProject({ id: "project-2", name: "Redesign" }),
    ];
    const stats = [
      {
        projectId: "project-1",
        tasks: {
          total: 2,
          byStatus: [{ status: "READY", count: 2 }],
        },
        jobs: {
          total: 1,
          byStatus: [{ status: "completed", count: 1 }],
        },
      },
      {
        projectId: "project-2",
        tasks: {
          total: 0,
          byStatus: [],
        },
        jobs: {
          total: 0,
          byStatus: [],
        },
      },
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
    projectServiceMock.getProjectsStats.mockResolvedValue(stats);

    const { loadMoreProjects } = await import("../actions");
    const result = await loadMoreProjects({ cursor: "project-0" });

    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      cursor: "project-0",
      limit: 20,
    });
    expect(projectServiceMock.getProjectsStats).toHaveBeenCalledWith([
      "project-1",
      "project-2",
    ]);
    expect(result).toEqual({
      projects,
      nextCursor: "project-3",
      statsByProjectId: {
        "project-1": stats[0],
        "project-2": stats[1],
      },
    });
  });

  it("rejects unauthenticated callers before loading projects", async () => {
    getSessionMock.mockResolvedValue(null);

    const { loadMoreProjects } = await import("../actions");

    await expect(loadMoreProjects({ cursor: "project-0" })).rejects.toThrow(
      UnAuthenticatedError,
    );
    expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
    expect(projectServiceMock.getProjectsStats).not.toHaveBeenCalled();
  });
});
