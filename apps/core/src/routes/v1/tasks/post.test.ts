import { OpenAPIHono } from "@hono/zod-openapi";
import { Channel, TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPostTask, { createTaskRequestSchema } from "./post";

const {
  generateTaskNameMock,
  mapTaskMock,
  notifyWorkspaceApproversOfPendingGrantMock,
  orchestratorFindFirstMock,
  projectFindFirstMock,
  prismaTransactionMock,
  requestWorkspaceGrantMock,
  requireTaskAssignableCoworkerMock,
  taskCreateMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  generateTaskNameMock: vi.fn(),
  mapTaskMock: vi.fn(),
  notifyWorkspaceApproversOfPendingGrantMock: vi.fn(),
  orchestratorFindFirstMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requestWorkspaceGrantMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  taskCreateMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

function buildMapTaskResponse(task: {
  id: string;
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
    description: null,
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
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    orchestrator: {
      findFirst: orchestratorFindFirstMock,
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
});

describe("POST /tasks", () => {
  function createApp() {
    const app = new OpenAPIHono<{
      Variables: AuthVariables & WorkspaceVariables;
    }>();

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

    mountPostTask(app as unknown as OpenAPIHonoWithAuth);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    generateTaskNameMock.mockResolvedValue("Generated name");
    taskCreateMock.mockResolvedValue({ id: "tsk_123" });
    mapTaskMock.mockImplementation((task) => buildMapTaskResponse(task));
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          project: {
            findFirst: projectFindFirstMock,
          },
          task: {
            create: taskCreateMock,
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
      select: { id: true },
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

    expect(response.status).toBe(400);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });
});

describe("POST /tasks orchestrator create", () => {
  function createOrchestratorApp(options?: {
    orchestratorId?: string;
    withContext?: boolean;
  }) {
    const app = new OpenAPIHono<{
      Variables: AuthVariables & WorkspaceVariables;
    }>();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "orchestrator" as const,
        ...(options?.orchestratorId
          ? { orchestratorId: options.orchestratorId }
          : {}),
        ...(options?.withContext !== false
          ? {
              context: {
                userId: "user_123",
                organizationId: "org_123" as string | null,
              },
            }
          : {}),
      });
      c.set("workspaceContext", {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_123",
        organizationId: "org_123",
      });

      return await next();
    });

    mountPostTask(app as unknown as OpenAPIHonoWithAuth);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    generateTaskNameMock.mockResolvedValue("Generated name");
    taskCreateMock.mockResolvedValue({ id: "tsk_orch" });
    mapTaskMock.mockImplementation((task) => buildMapTaskResponse(task));
    orchestratorFindFirstMock.mockResolvedValue(null);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          project: {
            findFirst: projectFindFirstMock,
          },
          task: {
            create: taskCreateMock,
          },
        });
      },
    );
  });

  it("rejects create when orchestrator has context but no active orchestratorId", async () => {
    const app = createOrchestratorApp({ withContext: true });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orch task",
        description: null,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "No active orchestrator instance for context user",
    );
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("rejects create when middleware snapshot is stale after purge", async () => {
    // Auth still carries a snapshotted orchestratorId, but the active-row
    // re-check at write time finds nothing (archived mid-request).
    const app = createOrchestratorApp({
      orchestratorId: "01960001-0001-7001-8001-000000000099",
      withContext: true,
    });
    orchestratorFindFirstMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orch task",
        description: null,
        assigneeId: null,
        status: TaskStatus.DRAFT,
        channel: Channel.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "No active orchestrator instance for context user",
    );
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("creates with creatorOrchestratorId when bound", async () => {
    const orchestratorId = "01960001-0001-7001-8001-000000000099";
    const app = createOrchestratorApp({ orchestratorId, withContext: true });
    orchestratorFindFirstMock.mockResolvedValue({
      id: orchestratorId,
      userId: "user_123",
      archivedAt: null,
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orch task",
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
          creatorOrchestratorId: orchestratorId,
          creatorUserId: null,
          creatorCoworkerId: null,
        }),
      }),
    );
  });
});

describe("POST /tasks delegated coworker create grant", () => {
  function createDelegatedCoworkerApp() {
    const app = new OpenAPIHono<{
      Variables: AuthVariables & WorkspaceVariables;
    }>();

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

    mountPostTask(app as unknown as OpenAPIHonoWithAuth);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    generateTaskNameMock.mockResolvedValue("Generated name");
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_123" });
    taskCreateMock.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "tsk_parked",
        ...args.data,
      }),
    );
    mapTaskMock.mockImplementation((task) =>
      buildMapTaskResponse({
        id: task.id,
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
      select: { id: true },
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
