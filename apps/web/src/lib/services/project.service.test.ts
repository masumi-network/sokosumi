import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreClientMock = {
  deleteProjectsById: vi.fn(),
  deleteProjectsByIdJobsByJobId: vi.fn(),
  deleteProjectsByIdTasksByTaskId: vi.fn(),
  getProjects: vi.fn(),
  getProjectsById: vi.fn(),
  getProjectsByIdContextMd: vi.fn(),
  getProjectsStats: vi.fn(),
  patchProjectsById: vi.fn(),
  postProjects: vi.fn(),
  putProjectsByIdDesignMd: vi.fn(),
  deleteProjectsByIdDesignMd: vi.fn(),
  postProjectsByIdJobs: vi.fn(),
  postProjectsByIdTasks: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.status = options?.status;
    }
  },
}));

function buildProject(overrides?: Partial<{ id: string; name: string }>) {
  return {
    id: "project-1",
    workspaceId: "workspace-1",
    name: "Launch plan",
    briefing: null,
    briefingUrl: null,
    websiteUrl: null,
    logo: null,
    designMd: null,
    memoryEnabled: true,
    memoryModel: {
      id: "mistral/mistral-medium-latest",
      label: "Mistral Medium",
      region: "eu" as const,
    },
    contextMd: null,
    contextMdUpdating: false,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
    ...overrides,
  };
}

describe("project.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists projects and unwraps pagination", async () => {
    const project = buildProject();
    coreClientMock.getProjects.mockResolvedValue({
      data: [project],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 42,
          nextCursor: "project-2",
        },
      },
    });

    const { projectService } = await import("./project.service");
    const result = await projectService.listProjects({
      cursor: "project-1",
      limit: 20,
    });

    expect(coreClientMock.getProjects).toHaveBeenCalledWith({
      cursor: "project-1",
      limit: 20,
    });
    expect(result).toEqual({
      projects: [project],
      pagination: {
        cursor: null,
        limit: 20,
        total: 42,
        nextCursor: "project-2",
      },
    });
  });

  it("loads project stats for specific project ids", async () => {
    const stats = {
      projectId: "project-1",
      tasks: {
        total: 2,
        byStatus: [{ status: "READY", count: 2 }],
      },
      jobs: {
        total: 1,
        byStatus: [{ status: "completed", count: 1 }],
      },
    };
    coreClientMock.getProjectsStats.mockResolvedValue({
      data: {
        projects: [stats],
      },
    });

    const { projectService } = await import("./project.service");
    const result = await projectService.getProjectsStats(["project-1"]);

    expect(coreClientMock.getProjectsStats).toHaveBeenCalledWith({
      projectIds: ["project-1"],
    });
    expect(result).toEqual([stats]);
  });

  it("returns no stats without calling Core for an empty id list", async () => {
    const { projectService } = await import("./project.service");
    const result = await projectService.getProjectsStats([]);

    expect(coreClientMock.getProjectsStats).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("returns null when a project lookup returns 404", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    coreClientMock.getProjectsById.mockRejectedValue(
      new CoreApiRequestError("not found", { status: 404 }),
    );

    const { projectService } = await import("./project.service");
    const result = await projectService.getProjectById("project-missing");

    expect(coreClientMock.getProjectsById).toHaveBeenCalledWith(
      "project-missing",
    );
    expect(result).toBeNull();
  });

  it("rethrows when a project lookup fails for non-404 errors", async () => {
    coreClientMock.getProjectsById.mockRejectedValue(
      new Error("server failed"),
    );

    const { projectService } = await import("./project.service");

    await expect(projectService.getProjectById("project-1")).rejects.toThrow(
      "server failed",
    );
  });

  it("creates, updates, and deletes projects via Core", async () => {
    const project = buildProject();
    coreClientMock.postProjects.mockResolvedValue({ data: project });
    coreClientMock.patchProjectsById.mockResolvedValue({
      data: buildProject({ name: "Updated launch plan" }),
    });
    coreClientMock.deleteProjectsById.mockResolvedValue({
      data: { id: "project-1", deleted: true },
    });

    const { projectService } = await import("./project.service");
    const created = await projectService.createProject({
      name: "Launch plan",
      briefing: null,
    });
    const updated = await projectService.patchProject("project-1", {
      name: "Updated launch plan",
    });
    const deleted = await projectService.deleteProject("project-1");

    expect(coreClientMock.postProjects).toHaveBeenCalledWith({
      name: "Launch plan",
      briefing: null,
      websiteUrl: null,
    });
    expect(coreClientMock.patchProjectsById).toHaveBeenCalledWith("project-1", {
      name: "Updated launch plan",
    });
    expect(coreClientMock.deleteProjectsById).toHaveBeenCalledWith("project-1");
    expect(created).toEqual(project);
    expect(updated).toEqual(buildProject({ name: "Updated launch plan" }));
    expect(deleted).toEqual({ id: "project-1", deleted: true });
  });

  it("adds and removes project jobs and tasks via Core", async () => {
    const project = buildProject();
    coreClientMock.postProjectsByIdJobs.mockResolvedValue({ data: project });
    coreClientMock.deleteProjectsByIdJobsByJobId.mockResolvedValue({
      data: project,
    });
    coreClientMock.postProjectsByIdTasks.mockResolvedValue({ data: project });
    coreClientMock.deleteProjectsByIdTasksByTaskId.mockResolvedValue({
      data: project,
    });

    const { projectService } = await import("./project.service");
    await projectService.addJob("project-1", "job-1");
    await projectService.removeJob("project-1", "job-1");
    await projectService.addTask("project-1", "task-1");
    await projectService.removeTask("project-1", "task-1");

    expect(coreClientMock.postProjectsByIdJobs).toHaveBeenCalledWith(
      "project-1",
      { jobId: "job-1" },
    );
    expect(coreClientMock.deleteProjectsByIdJobsByJobId).toHaveBeenCalledWith({
      id: "project-1",
      jobId: "job-1",
    });
    expect(coreClientMock.postProjectsByIdTasks).toHaveBeenCalledWith(
      "project-1",
      { taskId: "task-1" },
    );
    expect(coreClientMock.deleteProjectsByIdTasksByTaskId).toHaveBeenCalledWith(
      {
        id: "project-1",
        taskId: "task-1",
      },
    );
  });

  it("loads project memory and returns null on 404", async () => {
    const contextMd = {
      content: "# Memory",
      url: "https://blob.example/CONTEXT.md",
      updatedAt: "2026-08-16T10:00:00.000Z",
      version: 1,
      model: {
        id: "mistral/mistral-medium-latest",
        label: "Mistral Medium",
        region: "eu",
      },
      lineCount: 1,
    };
    coreClientMock.getProjectsByIdContextMd.mockResolvedValue({
      data: contextMd,
    });

    const { projectService } = await import("./project.service");
    const result = await projectService.getProjectContextMd("project-1");

    expect(coreClientMock.getProjectsByIdContextMd).toHaveBeenCalledWith(
      "project-1",
    );
    expect(result).toEqual(contextMd);

    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    coreClientMock.getProjectsByIdContextMd.mockRejectedValue(
      new CoreApiRequestError("not found", { status: 404 }),
    );
    await expect(
      projectService.getProjectContextMd("project-missing"),
    ).resolves.toBeNull();
  });

  it("removes project DESIGN.md via Core", async () => {
    const project = buildProject();
    coreClientMock.deleteProjectsByIdDesignMd.mockResolvedValue({
      data: project,
    });

    const { projectService } = await import("./project.service");
    await projectService.removeProjectDesignMd("project-1");

    expect(coreClientMock.deleteProjectsByIdDesignMd).toHaveBeenCalledWith(
      "project-1",
    );
  });
});
