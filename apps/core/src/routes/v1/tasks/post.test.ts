import { Channel, TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostTask, { createTaskRequestSchema } from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  ensureProjectFilesTokenMock,
  generateTaskNameMock,
  mapTaskMock,
  notifyWorkspaceApproversOfPendingGrantMock,
  projectFindFirstMock,
  projectUpdateManyMock,
  prismaTransactionMock,
  requestWorkspaceGrantMock,
  resolveEffectiveDesignMdMock,
  requireTaskAssignableCoworkerMock,
  taskCreateMock,
  taskFindUniqueOrThrowMock,
  uploadProjectBriefingFileMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  ensureProjectFilesTokenMock: vi.fn(),
  generateTaskNameMock: vi.fn(),
  mapTaskMock: vi.fn(),
  notifyWorkspaceApproversOfPendingGrantMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requestWorkspaceGrantMock: vi.fn(),
  resolveEffectiveDesignMdMock: vi.fn().mockResolvedValue(null),
  requireTaskAssignableCoworkerMock: vi.fn(),
  taskCreateMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  uploadProjectBriefingFileMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/project-files-blob", () => ({
  ensureProjectFilesToken: ensureProjectFilesTokenMock,
  uploadProjectBriefingFile: uploadProjectBriefingFileMock,
}));

function buildMapTaskResponse(task: {
  id: string;
  description?: string | null;
  name?: string;
  status?: TaskStatus;
  organizationId?: string | null;
  grantResumeStatus?: "DRAFT" | "READY" | null;
  pendingVendorGrantId?: string | null;
}) {
  const organizationId = task.organizationId ?? "org_123";

  return {
    id: task.id,
    createdAt: "2026-04-02T08:00:00.000Z",
    updatedAt: "2026-04-02T08:00:00.000Z",
    ownerId: "user_123",
    organizationId,
    projectId: null,
    owner: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    userId: "user_123",
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    organization: organizationId
      ? {
          id: organizationId,
          name: "Acme Labs",
          slug: "acme-labs",
        }
      : null,
    assigneeId: null,
    assignee: null,
    coworkerId: null,
    coworker: null,
    creator: {
      type: "user" as const,
      id: "user_123",
      user: {
        id: "user_123",
        name: "Ada Lovelace",
        image: null,
      },
    },
    orchestratorId: null,
    orchestrator: null,
    name: task.name ?? "New Task",
    description: task.description ?? null,
    status: task.status ?? TaskStatus.DRAFT,
    metadata: null,
    nextRunAt: null,
    credits: 0,
    events: [],
    jobs: [],
    grantResumeStatus:
      task.status === TaskStatus.GRANT_PENDING
        ? (task.grantResumeStatus ?? TaskStatus.DRAFT)
        : null,
    pendingVendorGrantId:
      task.status === TaskStatus.GRANT_PENDING
        ? (task.pendingVendorGrantId ?? null)
        : null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId,
      organization: organizationId
        ? {
            id: organizationId,
            name: "Acme Labs",
            slug: "acme-labs",
          }
        : null,
    },
    share: null,
    links: [],
    files: [],
  };
}

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/design-md-effective", () => ({
  resolveEffectiveDesignMd: resolveEffectiveDesignMdMock,
}));

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();

  return {
    ...actual,
    requestWorkspaceGrant: requestWorkspaceGrantMock,
    notifyWorkspaceApproversOfPendingGrant:
      notifyWorkspaceApproversOfPendingGrantMock,
  };
});

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();

  return {
    ...actual,
    mapTask: mapTaskMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    project: {
      findFirst: projectFindFirstMock,
      updateMany: projectUpdateManyMock,
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
  },
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));

const CREATE_GRANT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function mockWorkspaceGrantInTransaction(
  status: VendorGrantStatus,
  created = false,
) {
  const grant = {
    id: CREATE_GRANT_ID,
    status,
  };
  requestWorkspaceGrantMock.mockResolvedValue({ grant, created });
}

describe("createTaskRequestSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEffectiveDesignMdMock.mockResolvedValue(null);
  });

  it("defaults status to DRAFT when omitted", () => {
    const result = createTaskRequestSchema.parse({
      name: "New Task",
      description: "Task description",
      assigneeId: null,
    });

    expect(result.status).toBe(TaskStatus.DRAFT);
  });

  it("accepts READY status", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      assigneeId: "cow_123",
      status: TaskStatus.READY,
    });

    expect(result.status).toBe(TaskStatus.READY);
    expect(result.assigneeId).toBe("cow_123");
  });

  it("accepts deprecated coworkerId as assigneeId", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      coworkerId: "cow_legacy",
      status: TaskStatus.READY,
    });

    expect(result.assigneeId).toBe("cow_legacy");
    expect(result).not.toHaveProperty("coworkerId");
  });

  it("rejects conflicting assigneeId and coworkerId", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "Ready task",
        description: null,
        assigneeId: "cow_a",
        coworkerId: "cow_b",
        status: TaskStatus.READY,
      });
    }).toThrow();
  });

  it("rejects READY status without assigneeId", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "Ready task",
        description: null,
        assigneeId: null,
        status: TaskStatus.READY,
      });
    }).toThrow();
  });

  it("accepts READY status with whitespace coworkerId at schema layer", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      assigneeId: "  ",
      status: TaskStatus.READY,
    });

    expect(result.status).toBe(TaskStatus.READY);
  });

  it("trims a provided name", () => {
    const result = createTaskRequestSchema.parse({
      name: "  Hello  ",
      description: null,
      assigneeId: null,
    });

    expect(result.name).toBe("Hello");
  });

  it("rejects a whitespace-only name", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "   ",
        description: null,
        assigneeId: null,
      });
    }).toThrow();
  });

  it("accepts a projectId", () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

    const result = createTaskRequestSchema.parse({
      name: "Project task",
      description: null,
      projectId,
      assigneeId: null,
    });

    expect(result.projectId).toBe(projectId);
  });

  it("rejects unsupported status values", () => {
    Object.values(TaskStatus).forEach((status) => {
      if (status !== TaskStatus.DRAFT && status !== TaskStatus.READY) {
        expect(() => {
          createTaskRequestSchema.parse({
            name: "Invalid task",
            description: null,
            assigneeId: null,
            status,
          });
        }).toThrow();
      }
    });
  });

  it("accepts deprecated origin as channel", () => {
    const result = createTaskRequestSchema.parse({
      name: "Origin task",
      description: null,
      assigneeId: null,
      origin: Channel.EMAIL,
    });

    expect(result.channel).toBe(Channel.EMAIL);
    expect(result.origin).toBe(Channel.EMAIL);
  });

  it("prefers channel when both channel and matching origin are set", () => {
    const result = createTaskRequestSchema.parse({
      name: "Both task",
      description: null,
      assigneeId: null,
      channel: Channel.SLACK,
      origin: Channel.SLACK,
    });

    expect(result.channel).toBe(Channel.SLACK);
  });

  it("rejects conflicting channel and origin", () => {
    const result = createTaskRequestSchema.safeParse({
      name: "Conflict task",
      description: null,
      assigneeId: null,
      channel: Channel.SLACK,
      origin: Channel.EMAIL,
    });

    expect(result.success).toBe(false);
  });

  it("defaults channel to SOKOSUMI when neither channel nor origin is set", () => {
    const result = createTaskRequestSchema.parse({
      name: "Default channel task",
      description: null,
      assigneeId: null,
    });

    expect(result.channel).toBe(Channel.SOKOSUMI);
  });

  it("accepts a custom DESIGN.md context URL and rejects external URLs", () => {
    const validUrl =
      "https://store.public.blob.vercel-storage.com/design-md/adhoc/user_123/example.md";

    expect(
      createTaskRequestSchema.parse({
        name: "Custom brand",
        assigneeId: null,
        context: { brand: { url: validUrl } },
      }).context,
    ).toEqual({ brand: { url: validUrl } });

    expect(
      createTaskRequestSchema.safeParse({
        name: "External brand",
        assigneeId: null,
        context: { brand: { url: "https://example.com/DESIGN.md" } },
      }).success,
    ).toBe(false);
  });
});

describe("POST /tasks", () => {
  function createApp() {
    const app = new OpenAPIHonoWithAuth();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      });
      c.set("workspaceContext", {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId: "org_123",
      });

      return await next();
    });

    mountPostTask(app);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveEffectiveDesignMdMock.mockResolvedValue(null);
    generateTaskNameMock.mockResolvedValue("Generated name");
    taskCreateMock.mockResolvedValue({ id: "tsk_123" });
    ensureProjectFilesTokenMock.mockResolvedValue("project_files_token");
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    uploadProjectBriefingFileMock.mockResolvedValue(
      "https://store.public.blob.vercel-storage.com/projects/project_1/project_files_token/BRIEFING.md",
    );
    taskFindUniqueOrThrowMock.mockImplementation(async () => {
      const result = taskCreateMock.mock.results.at(-1);
      return result ? await result.value : { id: "tsk_123" };
    });
    mapTaskMock.mockImplementation((task) => buildMapTaskResponse(task));
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          project: {
            findFirst: projectFindFirstMock,
          },
          task: {
            create: taskCreateMock,
            findUniqueOrThrow: taskFindUniqueOrThrowMock,
          },
        });
      },
    );
  });

  it("uses workspaceContext and persists workspaceId on create", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "New Task",
        description: null,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "user_123",
          organizationId: "org_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
          projectId: null,
        }),
      }),
    );
  });

  it("rejects create when the member has no assigned organization seat", async () => {
    vi.mocked(requireAssignedOrganizationSeat).mockRejectedValueOnce(
      new HTTPException(403, {
        message: "An assigned seat is required to use this organization",
        cause: { kind: CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED },
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "New Task",
        description: null,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(403);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("verifies and persists a project assignment on create", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue({ id: projectId });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Project Task",
        description: null,
        projectId,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: projectId,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: {
        id: true,
        filesToken: true,
        designMdUrl: true,
        briefing: true,
        briefingUrl: true,
        contextMdUrl: true,
      },
    });
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId,
        }),
      }),
    );
  });

  it("rejects a project from outside the active workspace", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Project Task",
        description: null,
        projectId,
        assigneeId: null,
        status: TaskStatus.DRAFT,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("prepends project brand, briefing, and memory by default", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const designMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md";
    const briefingUrl = "https://store.public.blob.vercel-storage.com/brief.md";
    const contextMdUrl =
      "https://store.public.blob.vercel-storage.com/context.md";
    projectFindFirstMock.mockResolvedValue({
      id: projectId,
      designMdUrl,
      briefingUrl,
      contextMdUrl,
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Project task",
        description: "Original description",
        projectId,
        assigneeId: null,
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${designMdUrl})\n[BRIEFING.md](${briefingUrl})\n[CONTEXT.md](${contextMdUrl})\n\nOriginal description`,
        }),
      }),
    );
    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
  });

  it("heals a missing briefing URL before creating the task", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const briefingUrl =
      "https://store.public.blob.vercel-storage.com/projects/project_1/project_files_token/BRIEFING.md";
    projectFindFirstMock.mockResolvedValueOnce({
      id: projectId,
      filesToken: null,
      designMdUrl: null,
      briefing: "Existing briefing",
      briefingUrl: null,
      contextMdUrl: null,
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Project task",
        description: "Original description",
        projectId,
        assigneeId: null,
      }),
    });

    expect(response.status).toBe(201);
    expect(projectFindFirstMock).toHaveBeenCalledTimes(2);
    expect(uploadProjectBriefingFileMock).toHaveBeenCalledWith(
      projectId,
      "project_files_token",
      "Existing briefing",
    );
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: projectId,
        workspaceId: "11111111-1111-7111-8111-111111111111",
        briefing: "Existing briefing",
        briefingUrl: null,
      },
      data: { briefingUrl },
    });
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[BRIEFING.md](${briefingUrl})\n\nOriginal description`,
        }),
      }),
    );
  });

  it("honors explicit context opt-outs", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue({
      id: projectId,
      designMdUrl:
        "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md",
      briefingUrl: "https://store.public.blob.vercel-storage.com/brief.md",
      contextMdUrl: "https://store.public.blob.vercel-storage.com/context.md",
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No context",
        description: "Original description",
        projectId,
        assigneeId: null,
        context: { brand: false, briefing: false, memory: false },
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: "Original description" }),
      }),
    );
    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
  });

  it("uses effective workspace brand when requested", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const workspaceDesignMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/organizations/brand.md";
    projectFindFirstMock.mockResolvedValue({
      id: projectId,
      designMdUrl:
        "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md",
      briefingUrl: null,
      contextMdUrl: null,
    });
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "DESIGN.md",
      url: workspaceDesignMdUrl,
      owner: { type: "organization", name: "Acme", logo: null },
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Workspace brand",
        projectId,
        assigneeId: null,
        context: { brandSource: "workspace" },
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${workspaceDesignMdUrl})`,
        }),
      }),
    );
  });

  it("accepts a custom brand under the caller's ad hoc prefix", async () => {
    const brandUrl =
      "https://store.public.blob.vercel-storage.com/design-md/adhoc/user_123/custom.md";

    const response = await createApp().request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Custom owned brand",
        assigneeId: null,
        context: { brand: { url: brandUrl } },
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${brandUrl})`,
        }),
      }),
    );
    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
  });

  it("accepts a custom brand equal to the selected project's DESIGN.md", async () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const brandUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/owned.md";
    projectFindFirstMock.mockResolvedValue({
      id: projectId,
      designMdUrl: brandUrl,
      briefingUrl: null,
      contextMdUrl: null,
    });

    const response = await createApp().request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Custom project brand",
        projectId,
        assigneeId: null,
        context: { brand: { url: brandUrl } },
      }),
    });

    expect(response.status).toBe(201);
    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
  });

  it("accepts a custom brand equal to the caller's effective DESIGN.md", async () => {
    const brandUrl =
      "https://store.public.blob.vercel-storage.com/design-md/organizations/effective.md";
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "DESIGN.md",
      url: brandUrl,
      owner: { type: "organization", name: "Acme", logo: null },
    });

    const response = await createApp().request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Custom effective brand",
        assigneeId: null,
        context: { brand: { url: brandUrl } },
      }),
    });

    expect(response.status).toBe(201);
  });

  it("rejects a custom brand owned by another caller", async () => {
    const brandUrl =
      "https://store.public.blob.vercel-storage.com/design-md/adhoc/user_other/custom.md";

    const response = await createApp().request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Foreign custom brand",
        assigneeId: null,
        context: { brand: { url: brandUrl } },
      }),
    });

    expect(response.status).toBe(422);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("does not duplicate context links already in description", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const designMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md";
    const briefingUrl = "https://store.public.blob.vercel-storage.com/brief.md";
    const description = `[DESIGN.md](${designMdUrl})\n[BRIEFING.md](${briefingUrl})\n\nOriginal`;
    projectFindFirstMock.mockResolvedValue({
      id: projectId,
      designMdUrl,
      briefingUrl,
      contextMdUrl: null,
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Idempotent",
        description,
        projectId,
        assigneeId: null,
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description }),
      }),
    );
  });

  it("attaches only effective brand when task has no project", async () => {
    const app = createApp();
    const designMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/users/brand.md";
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "DESIGN.md",
      url: designMdUrl,
      owner: { type: "user" },
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Personal task",
        description: "Original",
        assigneeId: null,
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${designMdUrl})\n\nOriginal`,
        }),
      }),
    );
  });

  it("generates a name from the description when name is omitted", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Build landing page",
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Generated name" }),
      }),
    );
  });

  it("uses a provided name verbatim without generating", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My task",
        description: "Build landing page",
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(generateTaskNameMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "My task" }),
      }),
    );
  });

  it("accepts deprecated origin-only and persists resolved channel on create", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Origin task",
        description: null,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        origin: Channel.EMAIL,
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          events: {
            create: expect.objectContaining({
              channel: Channel.EMAIL,
            }),
          },
        }),
      }),
    );
  });

  it("rejects conflicting channel and origin", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Conflict task",
        description: null,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SLACK,
        origin: Channel.EMAIL,
      }),
    });

    expect(response.status).toBe(422);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });
});
describe("POST /tasks delegated coworker create grant", () => {
  function createDelegatedCoworkerApp() {
    const app = new OpenAPIHonoWithAuth();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: "vendor_123",
        context: {
          userId: "user_123",
          organizationId: "org_123",
        },
      });
      c.set("workspaceContext", {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId: "org_123",
      });

      return await next();
    });

    mountPostTask(app);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveEffectiveDesignMdMock.mockResolvedValue(null);
    generateTaskNameMock.mockResolvedValue("Generated name");
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_123" });
    taskCreateMock.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "tsk_parked",
        ...args.data,
      }),
    );
    taskFindUniqueOrThrowMock.mockImplementation(async () => {
      const result = taskCreateMock.mock.results.at(-1);
      return result ? await result.value : { id: "tsk_parked" };
    });
    mapTaskMock.mockImplementation((task) =>
      buildMapTaskResponse({
        id: task.id,
        description:
          typeof task.description === "string" ? task.description : null,
        name: typeof task.name === "string" ? task.name : "Parked Task",
        status: task.status as TaskStatus | undefined,
        organizationId: task.organizationId as string | null | undefined,
        grantResumeStatus: task.grantResumeStatus as
          | "DRAFT"
          | "READY"
          | null
          | undefined,
        pendingVendorGrantId: task.pendingVendorGrantId as
          | string
          | null
          | undefined,
      }),
    );
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          project: {
            findFirst: projectFindFirstMock,
          },
          task: {
            create: taskCreateMock,
            findUniqueOrThrow: taskFindUniqueOrThrowMock,
          },
        });
      },
    );
  });

  it("parks create with pendingVendorGrantId when workspace access is missing", async () => {
    mockWorkspaceGrantInTransaction(VendorGrantStatus.PENDING, true);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Parked Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(requestWorkspaceGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({ notify: false }),
      expect.anything(),
    );
    expect(notifyWorkspaceApproversOfPendingGrantMock).toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.GRANT_PENDING,
          grantResumeStatus: TaskStatus.DRAFT,
          pendingVendorGrantId: CREATE_GRANT_ID,
        }),
      }),
    );
  });

  it("parks project create without resolving or attaching owner context", async () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue({
      id: projectId,
      filesToken: null,
      designMdUrl:
        "https://store.public.blob.vercel-storage.com/design-md/projects/private.md",
      briefing: "Private project briefing",
      briefingUrl:
        "https://store.public.blob.vercel-storage.com/projects/project/secret/BRIEFING.md",
      contextMdUrl:
        "https://store.public.blob.vercel-storage.com/projects/project/secret/CONTEXT.md",
    });
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "DESIGN.md",
      url: "https://store.public.blob.vercel-storage.com/design-md/organizations/private.md",
      owner: { type: "organization", name: "Acme", logo: null },
    });
    mockWorkspaceGrantInTransaction(VendorGrantStatus.PENDING, true);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Parked private task",
          description: "Original description",
          projectId,
          assigneeId: null,
          context: { brandSource: "workspace" },
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.description).toBe("Original description");
    expect(body.data.description).not.toContain("](");
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.GRANT_PENDING,
          description: "Original description",
        }),
      }),
    );
    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
    expect(ensureProjectFilesTokenMock).not.toHaveBeenCalled();
    expect(uploadProjectBriefingFileMock).not.toHaveBeenCalled();
    expect(projectFindFirstMock).toHaveBeenCalledTimes(2);
  });

  it("still returns 201 when post-create grant notify fails", async () => {
    mockWorkspaceGrantInTransaction(VendorGrantStatus.PENDING, true);
    notifyWorkspaceApproversOfPendingGrantMock.mockRejectedValue(
      new Error("notify down"),
    );

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Parked Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalled();
  });

  it("notifies approvers when parking against an existing pending grant", async () => {
    mockWorkspaceGrantInTransaction(VendorGrantStatus.PENDING, false);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second Parked Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(notifyWorkspaceApproversOfPendingGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: CREATE_GRANT_ID }),
    );
  });

  it("creates unparked when requestWorkspaceGrant already returns GRANTED", async () => {
    mockWorkspaceGrantInTransaction(VendorGrantStatus.GRANTED, false);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Race Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(notifyWorkspaceApproversOfPendingGrantMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.DRAFT,
          pendingVendorGrantId: null,
        }),
      }),
    );
  });

  it("creates normally when workspace access is GRANTED", async () => {
    mockWorkspaceGrantInTransaction(VendorGrantStatus.GRANTED, false);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Allowed Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(requestWorkspaceGrantMock).toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.DRAFT,
          pendingVendorGrantId: null,
        }),
      }),
    );
  });

  it("rejects create when workspace access was DENIED", async () => {
    mockWorkspaceGrantInTransaction(VendorGrantStatus.DENIED, false);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Denied Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(requestWorkspaceGrantMock).toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects delegated create with invalid projectId before requesting grant", async () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue(null);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Bad Project Task",
          description: null,
          projectId,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: projectId,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: {
        id: true,
        filesToken: true,
        designMdUrl: true,
        briefing: true,
        briefingUrl: true,
        contextMdUrl: true,
      },
    });
    expect(requestWorkspaceGrantMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("parks create in personal workspaces when workspace grant is missing", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: null });
    mockWorkspaceGrantInTransaction(VendorGrantStatus.PENDING, true);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Personal Task",
          description: null,
          assigneeId: null,
          status: TaskStatus.DRAFT,
          channel: Channel.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(requestWorkspaceGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "11111111-1111-7111-8111-111111111111",
        notify: false,
      }),
      expect.anything(),
    );
    expect(taskCreateMock).toHaveBeenCalled();
  });
});
