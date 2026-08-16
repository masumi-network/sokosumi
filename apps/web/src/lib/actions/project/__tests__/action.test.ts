import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

const projectServiceMock = {
  addJob: vi.fn(),
  addTask: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectContextMd: vi.fn(),
  patchProject: vi.fn(),
  removeJob: vi.fn(),
  removeProjectDesignMd: vi.fn(),
  removeTask: vi.fn(),
  updateProjectDesignMd: vi.fn(),
};
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: toCoreApiActionErrorMock,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
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
    contextMd: null,
    contextMdUpdating: false,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
    ...overrides,
  };
}

describe("project actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      message:
        error instanceof Error
          ? error.message
          : "Failed to communicate with Core API",
    }));
  });

  it("creates a project with normalized input and revalidates the list", async () => {
    projectServiceMock.createProject.mockResolvedValue(buildProject());

    const { createProject } = await import("../action");
    const { revalidatePath } = await import("next/cache");
    const result = await createProject({
      name: "  Launch plan  ",
      briefing: "  Ship the launch  ",
    });

    expect(projectServiceMock.createProject).toHaveBeenCalledWith({
      name: "Launch plan",
      briefing: "Ship the launch",
      websiteUrl: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(result).toEqual({ projectId: "project-1" });
  });

  it("updates a project and revalidates list and detail routes", async () => {
    projectServiceMock.patchProject.mockResolvedValue(
      buildProject({ name: "Updated launch plan" }),
    );

    const { updateProject } = await import("../action");
    const { revalidatePath } = await import("next/cache");
    const result = await updateProject({
      projectId: " project-1 ",
      name: " Updated launch plan ",
      briefing: "   ",
    });

    expect(projectServiceMock.patchProject).toHaveBeenCalledWith("project-1", {
      name: "Updated launch plan",
      briefing: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(result).toEqual({ projectId: "project-1" });
  });

  it("deletes a project and revalidates list and detail routes", async () => {
    projectServiceMock.deleteProject.mockResolvedValue({
      id: "project-1",
      deleted: true,
    });

    const { deleteProject } = await import("../action");
    const { revalidatePath } = await import("next/cache");
    const result = await deleteProject({
      projectId: "project-1",
    });

    expect(projectServiceMock.deleteProject).toHaveBeenCalledWith("project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(result).toEqual({ projectId: "project-1" });
  });

  it("adds and removes jobs and tasks from a project", async () => {
    projectServiceMock.addJob.mockResolvedValue(buildProject());
    projectServiceMock.removeJob.mockResolvedValue(buildProject());
    projectServiceMock.addTask.mockResolvedValue(buildProject());
    projectServiceMock.removeTask.mockResolvedValue(buildProject());

    const {
      addProjectJob,
      addProjectTask,
      removeProjectJob,
      removeProjectTask,
    } = await import("../action");

    await addProjectJob({ projectId: " project-1 ", jobId: " job-1 " });
    await removeProjectJob({ projectId: " project-1 ", jobId: " job-1 " });
    await addProjectTask({ projectId: " project-1 ", taskId: " task-1 " });
    await removeProjectTask({
      projectId: " project-1 ",
      taskId: " task-1 ",
    });

    expect(projectServiceMock.addJob).toHaveBeenCalledWith(
      "project-1",
      "job-1",
    );
    expect(projectServiceMock.removeJob).toHaveBeenCalledWith(
      "project-1",
      "job-1",
    );
    expect(projectServiceMock.addTask).toHaveBeenCalledWith(
      "project-1",
      "task-1",
    );
    expect(projectServiceMock.removeTask).toHaveBeenCalledWith(
      "project-1",
      "task-1",
    );
  });

  it("loads project memory through the service", async () => {
    const contextMd = {
      content: "# Memory",
      url: "https://blob.example/CONTEXT.md",
      updatedAt: "2026-08-16T10:00:00.000Z",
      version: 1,
      model: {
        id: "mistral/mistral-medium-latest",
        label: "Mistral Medium",
        region: "eu" as const,
      },
      lineCount: 1,
    };
    projectServiceMock.getProjectContextMd.mockResolvedValue(contextMd);

    const { getProjectContextMd } = await import("../action");
    const result = await getProjectContextMd({
      projectId: " project-1 ",
    });

    expect(projectServiceMock.getProjectContextMd).toHaveBeenCalledWith(
      "project-1",
    );
    expect(result).toEqual(contextMd);
  });

  it("rejects a project without a name before calling the service", async () => {
    const { createProject } = await import("../action");

    await expect(
      createProject({
        name: " ",
        briefing: null,
      }),
    ).rejects.toThrow("Name required");

    expect(projectServiceMock.createProject).not.toHaveBeenCalled();
  });

  it("maps Core errors from mutations", async () => {
    projectServiceMock.patchProject.mockRejectedValue(new Error("Core failed"));
    toCoreApiActionErrorMock.mockReturnValue({
      message: "Project name is already in use",
    });

    const { updateProject } = await import("../action");

    await expect(
      updateProject({
        projectId: "project-1",
        name: "Launch plan",
        briefing: null,
      }),
    ).rejects.toThrow("Project name is already in use");

    expect(toCoreApiActionErrorMock).toHaveBeenCalledWith(expect.any(Error));
  });
});
