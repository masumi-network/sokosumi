import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreClientMock = {
  deleteProjectsById: vi.fn(),
  deleteProjectsByIdJobsByJobId: vi.fn(),
  deleteProjectsByIdSocialConnectionsByConnectionId: vi.fn(),
  deleteProjectsByIdTasksByTaskId: vi.fn(),
  getProjects: vi.fn(),
  getProjectsById: vi.fn(),
  getProjectsByIdCalendar: vi.fn(),
  getProjectsByIdContextMd: vi.fn(),
  getProjectsByIdSocialConnections: vi.fn(),
  getProjectsByIdSocialPosts: vi.fn(),
  getProjectsByIdSocialPostsByPostId: vi.fn(),
  getProjectsStats: vi.fn(),
  patchProjectsById: vi.fn(),
  patchProjectsByIdSocialPostsByPostId: vi.fn(),
  postProjects: vi.fn(),
  postProjectsByIdSocialConnectionsFinalize: vi.fn(),
  postProjectsByIdSocialConnectionsInitiate: vi.fn(),
  postProjectsByIdSocialPosts: vi.fn(),
  postProjectsByIdSocialPostsByPostIdCancel: vi.fn(),
  postProjectsByIdSocialPostsByPostIdPublish: vi.fn(),
  postProjectsByIdSocialPostsByPostIdSchedule: vi.fn(),
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
    latestUpdate: null,
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

  it("loads Project Calendar items through Core", async () => {
    coreClientMock.getProjectsByIdCalendar.mockResolvedValue({
      data: [],
      meta: {
        pagination: {
          cursor: null,
          limit: 100,
          total: 0,
          nextCursor: null,
        },
      },
    });

    const { projectService } = await import("./project.service");
    const query = {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-08T00:00:00.000Z"),
      limit: 100,
    };
    const result = await projectService.getProjectCalendar("project-1", query);

    expect(coreClientMock.getProjectsByIdCalendar).toHaveBeenCalledWith(
      "project-1",
      query,
    );
    expect(result).toEqual({
      items: [],
      pagination: {
        cursor: null,
        limit: 100,
        total: 0,
        nextCursor: null,
      },
    });
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

  it("lists a project's active social connections", async () => {
    const connections = [
      {
        id: "connection-1",
        provider: "x" as const,
        externalHandle: "sokosumi",
        status: "active" as const,
        connectedAt: new Date("2026-09-03T10:00:00.000Z"),
        disconnectedAt: null,
      },
    ];
    coreClientMock.getProjectsByIdSocialConnections.mockResolvedValue({
      data: connections,
    });

    const { projectService } = await import("./project.service");

    await expect(
      projectService.listSocialConnections("project-1"),
    ).resolves.toEqual(connections);
    expect(
      coreClientMock.getProjectsByIdSocialConnections,
    ).toHaveBeenCalledWith("project-1");
  });

  it("initiates a social connection with the generated request DTO", async () => {
    const initiation = {
      connectionId: "ca_123",
      redirectUrl: "https://connect.composio.dev/link-token",
    };
    coreClientMock.postProjectsByIdSocialConnectionsInitiate.mockResolvedValue({
      data: initiation,
    });

    const { projectService } = await import("./project.service");

    await expect(
      projectService.initiateSocialConnection("project-1", {
        action: "connect",
        provider: "x",
      }),
    ).resolves.toEqual(initiation);
    expect(
      coreClientMock.postProjectsByIdSocialConnectionsInitiate,
    ).toHaveBeenCalledWith("project-1", {
      action: "connect",
      provider: "x",
    });
  });

  it("finalizes a social connection with its opaque connection id", async () => {
    const connection = {
      id: "connection-1",
      provider: "x" as const,
      externalHandle: "sokosumi",
      status: "active" as const,
      connectedAt: new Date("2026-09-03T10:00:00.000Z"),
      disconnectedAt: null,
    };
    coreClientMock.postProjectsByIdSocialConnectionsFinalize.mockResolvedValue({
      data: connection,
    });

    const { projectService } = await import("./project.service");

    await expect(
      projectService.finalizeSocialConnection("project-1", "ca_123"),
    ).resolves.toEqual(connection);
    expect(
      coreClientMock.postProjectsByIdSocialConnectionsFinalize,
    ).toHaveBeenCalledWith("project-1", { connectionId: "ca_123" });
  });

  it("disconnects a social connection by its Project row id", async () => {
    const connection = {
      id: "connection-1",
      provider: "x" as const,
      externalHandle: "sokosumi",
      status: "disconnected" as const,
      connectedAt: new Date("2026-09-03T10:00:00.000Z"),
      disconnectedAt: new Date("2026-09-03T10:05:00.000Z"),
      providerRevocation: "succeeded" as const,
    };
    coreClientMock.deleteProjectsByIdSocialConnectionsByConnectionId.mockResolvedValue(
      { data: connection },
    );

    const { projectService } = await import("./project.service");

    await expect(
      projectService.disconnectSocialConnection("project-1", "connection-1"),
    ).resolves.toEqual(connection);
    expect(
      coreClientMock.deleteProjectsByIdSocialConnectionsByConnectionId,
    ).toHaveBeenCalledWith({ id: "project-1", connectionId: "connection-1" });
  });

  it("does not turn a Core request error into a social-connection success", async () => {
    coreClientMock.postProjectsByIdSocialConnectionsInitiate.mockRejectedValue(
      new Error("Core unavailable"),
    );

    const { projectService } = await import("./project.service");

    await expect(
      projectService.initiateSocialConnection("project-1", {
        action: "connect",
        provider: "x",
      }),
    ).rejects.toThrow("Core unavailable");
  });

  describe("social posts", () => {
    const post = {
      id: "post-1",
      projectId: "project-1",
      provider: "x" as const,
      text: "Hello",
      status: "DRAFT" as const,
      revision: 0,
    };

    it("lists social posts through the generated client", async () => {
      coreClientMock.getProjectsByIdSocialPosts.mockResolvedValue({
        data: [post],
      });

      const { projectService } = await import("./project.service");

      await expect(
        projectService.listSocialPosts("project-1"),
      ).resolves.toEqual([post]);
      expect(coreClientMock.getProjectsByIdSocialPosts).toHaveBeenCalledWith(
        "project-1",
      );
    });

    it("reads a single social post", async () => {
      coreClientMock.getProjectsByIdSocialPostsByPostId.mockResolvedValue({
        data: post,
      });

      const { projectService } = await import("./project.service");

      await expect(
        projectService.getSocialPost("project-1", "post-1"),
      ).resolves.toEqual(post);
      expect(
        coreClientMock.getProjectsByIdSocialPostsByPostId,
      ).toHaveBeenCalledWith("project-1", "post-1");
    });

    it("creates, updates, schedules, and cancels with the generated request DTOs", async () => {
      const scheduledAt = new Date("2026-10-01T10:00:00.000Z");
      coreClientMock.postProjectsByIdSocialPosts.mockResolvedValue({
        data: post,
      });
      coreClientMock.patchProjectsByIdSocialPostsByPostId.mockResolvedValue({
        data: { ...post, text: "Edited", revision: 1 },
      });
      coreClientMock.postProjectsByIdSocialPostsByPostIdSchedule.mockResolvedValue(
        { data: { ...post, status: "SCHEDULED", scheduledAt, revision: 2 } },
      );
      coreClientMock.postProjectsByIdSocialPostsByPostIdCancel.mockResolvedValue(
        { data: { ...post, status: "CANCELED", revision: 3 } },
      );

      const { projectService } = await import("./project.service");

      await expect(
        projectService.createSocialPost("project-1", { text: "Hello" }),
      ).resolves.toEqual(post);
      expect(coreClientMock.postProjectsByIdSocialPosts).toHaveBeenCalledWith(
        "project-1",
        { text: "Hello" },
      );

      await expect(
        projectService.updateSocialPost("project-1", "post-1", {
          text: "Edited",
          revision: 0,
        }),
      ).resolves.toMatchObject({ text: "Edited", revision: 1 });
      expect(
        coreClientMock.patchProjectsByIdSocialPostsByPostId,
      ).toHaveBeenCalledWith("project-1", "post-1", {
        text: "Edited",
        revision: 0,
      });

      await expect(
        projectService.scheduleSocialPost("project-1", "post-1", {
          scheduledAt,
          timezone: "Europe/Berlin",
          socialConnectionId: "connection-1",
          revision: 1,
        }),
      ).resolves.toMatchObject({ status: "SCHEDULED", revision: 2 });
      expect(
        coreClientMock.postProjectsByIdSocialPostsByPostIdSchedule,
      ).toHaveBeenCalledWith("project-1", "post-1", {
        scheduledAt,
        timezone: "Europe/Berlin",
        socialConnectionId: "connection-1",
        revision: 1,
      });

      await expect(
        projectService.cancelSocialPost("project-1", "post-1", {
          revision: 2,
        }),
      ).resolves.toMatchObject({ status: "CANCELED", revision: 3 });
      expect(
        coreClientMock.postProjectsByIdSocialPostsByPostIdCancel,
      ).toHaveBeenCalledWith("project-1", "post-1", { revision: 2 });
    });

    it("publishes a post now with the observed revision", async () => {
      const publishedAt = new Date("2026-09-15T10:00:00.000Z");
      coreClientMock.postProjectsByIdSocialPostsByPostIdPublish.mockResolvedValue(
        {
          data: {
            ...post,
            status: "PUBLISHED",
            publishedAt,
            publishedUrl: "https://x.com/sokosumi/status/1",
            revision: 4,
          },
        },
      );

      const { projectService } = await import("./project.service");

      await expect(
        projectService.publishSocialPost("project-1", "post-1", {
          revision: 3,
        }),
      ).resolves.toMatchObject({
        status: "PUBLISHED",
        publishedAt,
        publishedUrl: "https://x.com/sokosumi/status/1",
        revision: 4,
      });
      expect(
        coreClientMock.postProjectsByIdSocialPostsByPostIdPublish,
      ).toHaveBeenCalledWith("project-1", "post-1", { revision: 3 });
    });

    it("propagates Core errors from publishing", async () => {
      coreClientMock.postProjectsByIdSocialPostsByPostIdPublish.mockRejectedValue(
        new Error("Social post cannot be published now"),
      );

      const { projectService } = await import("./project.service");

      await expect(
        projectService.publishSocialPost("project-1", "post-1", {
          revision: 0,
        }),
      ).rejects.toThrow("Social post cannot be published now");
    });

    it("propagates Core errors from social post mutations", async () => {
      coreClientMock.postProjectsByIdSocialPostsByPostIdSchedule.mockRejectedValue(
        new Error("Social post was modified, reload and retry"),
      );

      const { projectService } = await import("./project.service");

      await expect(
        projectService.scheduleSocialPost("project-1", "post-1", {
          scheduledAt: new Date("2026-10-01T10:00:00.000Z"),
          revision: 0,
        }),
      ).rejects.toThrow("Social post was modified, reload and retry");
    });
  });
});
