import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnAuthenticatedError } from "@/lib/auth/errors";

const getSessionResultMock = vi.fn();

const projectServiceMock = {
  listProjects: vi.fn(),
  pinProject: vi.fn(),
  unpinProject: vi.fn(),
  listPinnedProjects: vi.fn(),
};

// Mock only the session source and exercise the real `withSession` wrapper so
// its auth guard (and forged-session override) is covered, not reimplemented.
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: (...args: unknown[]) => getSessionResultMock(...args),
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
    getSessionResultMock.mockResolvedValue(
      ok({
        user: { id: "user-1" },
        session: { activeOrganizationId: "org-1" },
      }),
    );
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

    const { loadMoreProjects } = await import("./actions");
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
    getSessionResultMock.mockResolvedValue(ok(null));

    const { loadMoreProjects } = await import("./actions");

    await expect(loadMoreProjects({ cursor: "project-0" })).rejects.toThrow(
      UnAuthenticatedError,
    );
    expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
  });
  it.each([
    { userId: "user-1", organizationId: "org-2" },
    { userId: "user-2", organizationId: "org-1" },
    { userId: "user-1", organizationId: null },
  ])(
    "rejects a stale sidebar scope before reading projects: %j",
    async (expectedScope) => {
      const { loadMoreProjects } = await import("./actions");
      await expect(
        loadMoreProjects({ cursor: null, expectedScope }),
      ).rejects.toThrow("Project workspace changed");
      expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
    },
  );

  it("accepts the current personal workspace with a bounded page", async () => {
    getSessionResultMock.mockResolvedValue(
      ok({ user: { id: "user-1" }, session: { activeOrganizationId: null } }),
    );
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [],
      pagination: null,
    });
    const { loadMoreProjects } = await import("./actions");
    await expect(
      loadMoreProjects({
        cursor: null,
        expectedScope: { userId: "user-1", organizationId: null },
      }),
    ).resolves.toEqual({ projects: [], nextCursor: null });
    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      cursor: null,
      limit: 20,
    });
  });
});

describe("project Pin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionResultMock.mockResolvedValue(
      ok({
        user: { id: "user-1" },
        session: { activeOrganizationId: "org-1" },
      }),
    );
  });

  it("Pins a project for the signed-in reader", async () => {
    const starredAt = "2026-09-21T10:00:00.000Z";
    projectServiceMock.pinProject.mockResolvedValue({
      projectId: "project-1",
      starredAt,
    });

    const { pinProjectAction } = await import("./actions");

    await expect(pinProjectAction({ projectId: "project-1" })).resolves.toEqual(
      { projectId: "project-1", starredAt },
    );
    expect(projectServiceMock.pinProject).toHaveBeenCalledWith("project-1");
  });

  it("Unpins a project for the signed-in reader", async () => {
    projectServiceMock.unpinProject.mockResolvedValue({
      projectId: "project-1",
      starredAt: null,
    });

    const { unpinProjectAction } = await import("./actions");

    await expect(
      unpinProjectAction({ projectId: "project-1" }),
    ).resolves.toEqual({ projectId: "project-1", starredAt: null });
    expect(projectServiceMock.unpinProject).toHaveBeenCalledWith("project-1");
  });

  it("rejects unauthenticated callers before touching a Pin", async () => {
    const { err } = await import("neverthrow");
    getSessionResultMock.mockResolvedValue(err(new UnAuthenticatedError()));

    const { pinProjectAction } = await import("./actions");

    await expect(
      pinProjectAction({ projectId: "project-1" }),
    ).rejects.toThrow();
    expect(projectServiceMock.pinProject).not.toHaveBeenCalled();
  });

  it("lists the reader's Pins", async () => {
    projectServiceMock.listPinnedProjects.mockResolvedValue([buildProject()]);

    const { loadPinnedProjects } = await import("./actions");

    await expect(
      loadPinnedProjects({
        expectedScope: { userId: "user-1", organizationId: "org-1" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("refuses a Pin list belonging to a workspace the reader has left", async () => {
    const { loadPinnedProjects } = await import("./actions");

    // The guard exists so a Pin list cannot outlive an org switch: the rows
    // would be another workspace's projects rendered as this one's.
    await expect(
      loadPinnedProjects({
        expectedScope: { userId: "user-1", organizationId: "org-2" },
      }),
    ).rejects.toThrow("Project workspace changed");
    expect(projectServiceMock.listPinnedProjects).not.toHaveBeenCalled();
  });
});
