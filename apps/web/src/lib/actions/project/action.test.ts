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
  cancelSocialPost: vi.fn(),
  createProject: vi.fn(),
  createSocialPost: vi.fn(),
  deleteProject: vi.fn(),
  disconnectSocialConnection: vi.fn(),
  finalizeSocialConnection: vi.fn(),
  getProjectContextMd: vi.fn(),
  initiateSocialConnection: vi.fn(),
  patchProject: vi.fn(),
  removeProjectDesignMd: vi.fn(),
  scheduleSocialPost: vi.fn(),
  updateSocialPost: vi.fn(),
};
const toCoreApiActionErrorMock = vi.fn();
const resolveProjectSiteIconMock = vi.fn();

class CoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError,
  coreClient: {
    resolveProjectSiteIcon: (...args: unknown[]) =>
      resolveProjectSiteIconMock(...args),
  },
  mapCoreApiStatusToCommonErrorCode: (status?: number) => {
    if (status === 401 || status === 403) return "UNAUTHORIZED";
    if (status === 404) return "NOT_FOUND";
    if (status === 400 || status === 409 || status === 422) return "BAD_INPUT";
    return "INTERNAL_SERVER_ERROR";
  },
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

    const { createProject } = await import("./action");
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
    expect(result.projectId).toBe("project-1");
  });

  it("omits briefing from the patch when the caller did not pass it", async () => {
    projectServiceMock.patchProject.mockResolvedValue(buildProject());

    const { updateProject } = await import("./action");
    await updateProject({
      projectId: "project-1",
      name: "Launch plan",
      logo: "https://blob.example/logo.png",
    });

    expect(projectServiceMock.patchProject).toHaveBeenCalledWith("project-1", {
      name: "Launch plan",
      logo: "https://blob.example/logo.png",
    });
  });

  it("rejects a non-uuid projectId for site-icon resolution", async () => {
    const { resolveProjectSiteIcon } = await import("./action");
    const result = await resolveProjectSiteIcon({
      url: "https://example.com",
      projectId: "not-a-uuid",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_INPUT");
    }
    expect(resolveProjectSiteIconMock).not.toHaveBeenCalled();
  });

  it("maps Core 403/404/422 from site-icon resolution", async () => {
    const { resolveProjectSiteIcon } = await import("./action");

    resolveProjectSiteIconMock.mockRejectedValueOnce(
      new CoreApiRequestError("forbidden", { status: 403 }),
    );
    const forbidden = await resolveProjectSiteIcon({
      url: "https://example.com",
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) {
      expect(forbidden.error.code).toBe("UNAUTHORIZED");
    }

    resolveProjectSiteIconMock.mockRejectedValueOnce(
      new CoreApiRequestError("missing", { status: 404 }),
    );
    const missing = await resolveProjectSiteIcon({
      url: "https://example.com",
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("NOT_FOUND");
    }

    resolveProjectSiteIconMock.mockRejectedValueOnce(
      new CoreApiRequestError("invalid", { status: 422 }),
    );
    const invalid = await resolveProjectSiteIcon({
      url: "https://example.com",
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("BAD_INPUT");
    }
  });

  it("updates a project and revalidates list and detail routes", async () => {
    projectServiceMock.patchProject.mockResolvedValue(
      buildProject({ name: "Updated launch plan" }),
    );

    const { updateProject } = await import("./action");
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

    const { deleteProject } = await import("./action");
    const { revalidatePath } = await import("next/cache");
    const result = await deleteProject({
      projectId: "project-1",
    });

    expect(projectServiceMock.deleteProject).toHaveBeenCalledWith("project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(result).toEqual({ projectId: "project-1" });
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

    const { getProjectContextMd } = await import("./action");
    const result = await getProjectContextMd({
      projectId: " project-1 ",
    });

    expect(projectServiceMock.getProjectContextMd).toHaveBeenCalledWith(
      "project-1",
    );
    expect(result).toEqual(contextMd);
  });

  it("rejects an unparsable website URL instead of storing null", async () => {
    const { createProject } = await import("./action");

    await expect(
      createProject({
        name: "Launch plan",
        websiteUrl: "not-a-url",
      }),
    ).rejects.toThrow("Invalid website URL");

    expect(projectServiceMock.createProject).not.toHaveBeenCalled();
  });

  it("rejects a project without a name before calling the service", async () => {
    const { createProject } = await import("./action");

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

    const { updateProject } = await import("./action");

    await expect(
      updateProject({
        projectId: "project-1",
        name: "Launch plan",
        briefing: null,
      }),
    ).rejects.toThrow("Project name is already in use");

    expect(toCoreApiActionErrorMock).toHaveBeenCalledWith(expect.any(Error));
  });

  it("initiates a social connection with a Flight-safe redirect handoff", async () => {
    projectServiceMock.initiateSocialConnection.mockResolvedValue({
      connectionId: "ca_123",
      redirectUrl: "https://connect.composio.dev/link-token",
    });

    const { initiateProjectSocialConnection } = await import("./action");
    const result = await initiateProjectSocialConnection({
      projectId: " project-1 ",
      action: "connect",
    });

    expect(projectServiceMock.initiateSocialConnection).toHaveBeenCalledWith(
      "project-1",
      { action: "connect", provider: "x" },
    );
    expect(result).toEqual({
      ok: true,
      value: {
        connectionId: "ca_123",
        redirectUrl: "https://connect.composio.dev/link-token",
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("finalizes a social connection and revalidates Project pages", async () => {
    const connection = {
      id: "connection-1",
      provider: "x" as const,
      externalHandle: "sokosumi",
      status: "active" as const,
      connectedAt: new Date("2026-09-03T10:00:00.000Z"),
      disconnectedAt: null,
    };
    projectServiceMock.finalizeSocialConnection.mockResolvedValue(connection);

    const { finalizeProjectSocialConnection } = await import("./action");
    const { revalidatePath } = await import("next/cache");
    const result = await finalizeProjectSocialConnection({
      projectId: "project-1",
      connectionId: "ca_123",
    });

    expect(projectServiceMock.finalizeSocialConnection).toHaveBeenCalledWith(
      "project-1",
      "ca_123",
    );
    expect(result).toEqual({ ok: true, value: connection });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/edit");
  });

  it("disconnects a social connection and revalidates Project pages", async () => {
    const connection = {
      id: "connection-1",
      provider: "x" as const,
      externalHandle: "sokosumi",
      status: "disconnected" as const,
      connectedAt: new Date("2026-09-03T10:00:00.000Z"),
      disconnectedAt: new Date("2026-09-03T10:05:00.000Z"),
      providerRevocation: "succeeded" as const,
    };
    projectServiceMock.disconnectSocialConnection.mockResolvedValue(connection);

    const { disconnectProjectSocialConnection } = await import("./action");
    const { revalidatePath } = await import("next/cache");
    const result = await disconnectProjectSocialConnection({
      projectId: "project-1",
      socialConnectionId: "connection-1",
    });

    expect(projectServiceMock.disconnectSocialConnection).toHaveBeenCalledWith(
      "project-1",
      "connection-1",
    );
    expect(result).toEqual({ ok: true, value: connection });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/edit");
  });

  it("converts social-connection Core errors to a plain action error DTO", async () => {
    projectServiceMock.finalizeSocialConnection.mockRejectedValue(
      new Error("Unknown or expired connection"),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      code: "NOT_FOUND",
      message: "Unknown or expired connection",
    });

    const { finalizeProjectSocialConnection } = await import("./action");
    const { revalidatePath } = await import("next/cache");
    const result = await finalizeProjectSocialConnection({
      projectId: "project-1",
      connectionId: "ca_123",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Unknown or expired connection",
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
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

    it("creates a draft with trimmed ids and revalidates the social route", async () => {
      projectServiceMock.createSocialPost.mockResolvedValue(post);

      const { createProjectSocialPost } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await createProjectSocialPost({
        projectId: " project-1 ",
        text: "Hello",
        socialConnectionId: null,
      });

      expect(projectServiceMock.createSocialPost).toHaveBeenCalledWith(
        "project-1",
        { text: "Hello" },
      );
      expect(result).toEqual({ ok: true, value: post });
      expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
      expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/social");
    });

    it("creates a scheduled post from an ISO timestamp and timezone", async () => {
      projectServiceMock.createSocialPost.mockResolvedValue({
        ...post,
        status: "SCHEDULED",
      });

      const { createProjectSocialPost } = await import("./action");
      await createProjectSocialPost({
        projectId: "project-1",
        text: "Hello",
        socialConnectionId: "connection-1",
        scheduledAt: "2026-10-01T10:00:00.000Z",
        timezone: "Europe/Berlin",
      });

      expect(projectServiceMock.createSocialPost).toHaveBeenCalledWith(
        "project-1",
        {
          text: "Hello",
          socialConnectionId: "connection-1",
          scheduledAt: new Date("2026-10-01T10:00:00.000Z"),
          timezone: "Europe/Berlin",
        },
      );
    });

    it("rejects invalid social post input before calling the service", async () => {
      const { createProjectSocialPost, scheduleProjectSocialPost } =
        await import("./action");

      const emptyText = await createProjectSocialPost({
        projectId: "project-1",
        text: "",
      });
      expect(emptyText).toMatchObject({
        ok: false,
        error: { code: "BAD_INPUT" },
      });

      const badTimestamp = await scheduleProjectSocialPost({
        projectId: "project-1",
        postId: "post-1",
        scheduledAt: "tomorrow",
        revision: 0,
      });
      expect(badTimestamp).toMatchObject({
        ok: false,
        error: { code: "BAD_INPUT" },
      });
      expect(projectServiceMock.createSocialPost).not.toHaveBeenCalled();
      expect(projectServiceMock.scheduleSocialPost).not.toHaveBeenCalled();
    });

    it("updates a post with its revision and clears the account when null", async () => {
      projectServiceMock.updateSocialPost.mockResolvedValue({
        ...post,
        text: "Edited",
        revision: 1,
      });

      const { updateProjectSocialPost } = await import("./action");
      const result = await updateProjectSocialPost({
        projectId: "project-1",
        postId: " post-1 ",
        text: "Edited",
        socialConnectionId: null,
        revision: 0,
      });

      expect(projectServiceMock.updateSocialPost).toHaveBeenCalledWith(
        "project-1",
        "post-1",
        { text: "Edited", socialConnectionId: null, revision: 0 },
      );
      expect(result).toMatchObject({ ok: true, value: { revision: 1 } });
    });

    it("schedules and cancels a post through the service", async () => {
      projectServiceMock.scheduleSocialPost.mockResolvedValue({
        ...post,
        status: "SCHEDULED",
        revision: 1,
      });
      projectServiceMock.cancelSocialPost.mockResolvedValue({
        ...post,
        status: "CANCELED",
        revision: 2,
      });

      const { scheduleProjectSocialPost, cancelProjectSocialPost } =
        await import("./action");
      const { revalidatePath } = await import("next/cache");

      const scheduled = await scheduleProjectSocialPost({
        projectId: "project-1",
        postId: "post-1",
        scheduledAt: "2026-10-01T10:00:00.000Z",
        timezone: "Europe/Berlin",
        socialConnectionId: "connection-1",
        revision: 0,
      });
      expect(projectServiceMock.scheduleSocialPost).toHaveBeenCalledWith(
        "project-1",
        "post-1",
        {
          scheduledAt: new Date("2026-10-01T10:00:00.000Z"),
          timezone: "Europe/Berlin",
          socialConnectionId: "connection-1",
          revision: 0,
        },
      );
      expect(scheduled).toMatchObject({ ok: true, value: { revision: 1 } });

      const canceled = await cancelProjectSocialPost({
        projectId: "project-1",
        postId: "post-1",
        revision: 1,
      });
      expect(projectServiceMock.cancelSocialPost).toHaveBeenCalledWith(
        "project-1",
        "post-1",
        { revision: 1 },
      );
      expect(canceled).toMatchObject({ ok: true, value: { revision: 2 } });
      expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/social");
    });

    it("converts social post Core errors to a plain action error DTO", async () => {
      projectServiceMock.cancelSocialPost.mockRejectedValue(
        new Error("Social post was modified, reload and retry"),
      );
      toCoreApiActionErrorMock.mockReturnValue({
        code: "BAD_INPUT",
        message: "Social post was modified, reload and retry",
      });

      const { cancelProjectSocialPost } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await cancelProjectSocialPost({
        projectId: "project-1",
        postId: "post-1",
        revision: 0,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "BAD_INPUT",
          message: "Social post was modified, reload and retry",
        },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
});
