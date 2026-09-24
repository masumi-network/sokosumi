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
  cancelProjectCloseOwedWork: vi.fn(),
  closeProject: vi.fn(),
  createProject: vi.fn(),
  disconnectSocialConnection: vi.fn(),
  finalizeSocialConnection: vi.fn(),
  getProjectContextMd: vi.fn(),
  initiateSocialConnection: vi.fn(),
  patchProject: vi.fn(),
  removeProjectDesignMd: vi.fn(),
  retryProjectClose: vi.fn(),
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

function buildCloseStatus() {
  return {
    id: "123e4567-e89b-42d3-a456-426614174001",
    projectId: "project-1",
    state: "CLOSING" as const,
    cutoffAt: new Date("2026-09-14T10:00:00.000Z"),
    reason: null,
    attempts: 0,
    failure: null,
    completedAt: null,
    projectRevision: 4,
    owedOccurrenceCount: 2,
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

  it("closes a project with normalized input and revalidates calendar routes", async () => {
    const status = buildCloseStatus();
    projectServiceMock.closeProject.mockResolvedValue(status);

    const { closeProject } = await import("./action");
    const { revalidatePath } = await import("next/cache");
    await expect(
      closeProject({
        projectId: " project-1 ",
        operationId: "123e4567-e89b-42d3-a456-426614174003",
        expectedProjectRevision: 3,
        reason: "  Campaign complete  ",
      }),
    ).resolves.toEqual(status);

    expect(projectServiceMock.closeProject).toHaveBeenCalledWith("project-1", {
      operationId: "123e4567-e89b-42d3-a456-426614174003",
      expectedProjectRevision: 3,
      reason: "Campaign complete",
    });
    for (const path of [
      "/projects",
      "/projects/project-1",
      "/projects/project-1/calendar",
      "/calendar",
      "/tasks",
    ]) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("requires an operation UUID and a recovery reason", async () => {
    const { closeProject, retryProjectClose } = await import("./action");

    await expect(
      closeProject({
        projectId: "project-1",
        operationId: "not-a-uuid",
        expectedProjectRevision: 3,
      }),
    ).rejects.toThrow();
    await expect(
      retryProjectClose({
        projectId: "project-1",
        operationId: "123e4567-e89b-42d3-a456-426614174004",
        expectedProjectRevision: 4,
        reason: "   ",
      }),
    ).rejects.toThrow();

    expect(projectServiceMock.closeProject).not.toHaveBeenCalled();
    expect(projectServiceMock.retryProjectClose).not.toHaveBeenCalled();
  });

  it("sends retry and cancel-owed as separate recovery operations", async () => {
    const status = buildCloseStatus();
    projectServiceMock.retryProjectClose.mockResolvedValue(status);
    projectServiceMock.cancelProjectCloseOwedWork.mockResolvedValue(status);
    const { cancelProjectCloseOwedWork, retryProjectClose } = await import(
      "./action"
    );
    const retryInput = {
      projectId: "project-1",
      operationId: "123e4567-e89b-42d3-a456-426614174004",
      expectedProjectRevision: 4,
      reason: "Retry after review",
    };
    const cancelInput = {
      projectId: "project-1",
      operationId: "123e4567-e89b-42d3-a456-426614174005",
      expectedProjectRevision: 4,
      reason: "Cancel the blocked owed work",
    };

    await retryProjectClose(retryInput);
    await cancelProjectCloseOwedWork(cancelInput);

    expect(projectServiceMock.retryProjectClose).toHaveBeenCalledWith(
      "project-1",
      {
        operationId: retryInput.operationId,
        expectedProjectRevision: 4,
        reason: retryInput.reason,
      },
    );
    expect(projectServiceMock.cancelProjectCloseOwedWork).toHaveBeenCalledWith(
      "project-1",
      {
        operationId: cancelInput.operationId,
        expectedProjectRevision: 4,
        reason: cancelInput.reason,
      },
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
});
