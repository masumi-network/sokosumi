import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectServiceMock, notFoundMock } = vi.hoisted(() => ({
  projectServiceMock: {
    getProjectById: vi.fn(),
    getProjectsStats: vi.fn(),
    listProjectJobs: vi.fn(),
    listProjectTasks: vi.fn(),
  },
  notFoundMock: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/app/projects/components/project-detail-header", () => ({
  ProjectDetailHeader: () => null,
}));

vi.mock("@/app/projects/components/project-detail-actions", () => ({
  ProjectDetailActions: () => null,
}));

vi.mock("@/app/projects/components/project-briefing", () => ({
  ProjectBriefing: () => null,
}));

vi.mock("@/app/projects/components/project-memory-row", () => ({
  ProjectMemoryRow: () => null,
}));

vi.mock("@/app/projects/components/project-jobs-section", () => ({
  ProjectJobsSection: () => null,
}));

vi.mock("@/app/projects/components/project-tasks-section", () => ({
  ProjectTasksSection: () => null,
}));

function buildProject() {
  return {
    id: "project-1",
    workspaceId: "workspace-1",
    name: "Launch plan",
    briefing: null,
    briefingUrl: null,
    contextMd: null,
    contextMdUpdating: false,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
  };
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls notFound without loading jobs or tasks when the project is missing", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    const { default: ProjectDetailPage } = await import("../page");

    await expect(
      ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-missing" }),
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(projectServiceMock.getProjectById).toHaveBeenCalledWith(
      "project-missing",
    );
    expect(projectServiceMock.getProjectsStats).not.toHaveBeenCalled();
    expect(projectServiceMock.listProjectJobs).not.toHaveBeenCalled();
    expect(projectServiceMock.listProjectTasks).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("loads jobs, tasks, and stats in parallel after the project exists", async () => {
    const project = buildProject();
    projectServiceMock.getProjectById.mockResolvedValue(project);
    projectServiceMock.getProjectsStats.mockResolvedValue([
      {
        projectId: "project-1",
        tasks: {
          total: 0,
          byStatus: [],
        },
        jobs: {
          total: 0,
          byStatus: [],
        },
      },
    ]);
    projectServiceMock.listProjectJobs.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    projectServiceMock.listProjectTasks.mockResolvedValue({
      tasks: [],
      pagination: null,
    });

    const { default: ProjectDetailPage } = await import("../page");

    await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(projectServiceMock.listProjectJobs).toHaveBeenCalledWith(
      "project-1",
      { limit: 100 },
    );
    expect(projectServiceMock.listProjectTasks).toHaveBeenCalledWith(
      "project-1",
      { limit: 100 },
    );
    expect(projectServiceMock.getProjectsStats).toHaveBeenCalledWith([
      "project-1",
    ]);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound when stats are missing for an existing project", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    projectServiceMock.getProjectsStats.mockResolvedValue([]);
    projectServiceMock.listProjectJobs.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    projectServiceMock.listProjectTasks.mockResolvedValue({
      tasks: [],
      pagination: null,
    });

    const { default: ProjectDetailPage } = await import("../page");

    await expect(
      ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
