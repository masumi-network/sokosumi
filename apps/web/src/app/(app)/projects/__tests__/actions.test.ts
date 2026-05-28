import { beforeEach, describe, expect, it, vi } from "vitest";

const projectServiceMock = {
  getProjectsStats: vi.fn(),
  listProjects: vi.fn(),
};

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
    const result = await loadMoreProjects("project-0");

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
});
