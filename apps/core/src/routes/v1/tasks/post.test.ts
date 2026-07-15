import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin, VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPostTask, { createTaskRequestSchema } from "./post";

const {
  generateTaskNameMock,
  getWorkspaceGrantMock,
  mapTaskMock,
  notifyWorkspaceApproversOfPendingGrantMock,
  projectFindFirstMock,
  prismaTransactionMock,
  requestWorkspaceGrantCommittedMock,
  lockAndGetVendorGrantByIdMock,
  requireTaskAssignableCoworkerMock,
  taskCreateMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  generateTaskNameMock: vi.fn(),
  getWorkspaceGrantMock: vi.fn(),
  mapTaskMock: vi.fn(),
  notifyWorkspaceApproversOfPendingGrantMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requestWorkspaceGrantCommittedMock: vi.fn(),
  lockAndGetVendorGrantByIdMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  taskCreateMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

function buildMapTaskResponse(task: {
  id: string;
  name?: string;
  status?: TaskStatus;
  organizationId?: string | null;
  pendingVendorGrantId?: string | null;
}) {
  const organizationId = task.organizationId ?? "org_123";

  return {
    id: task.id,
    createdAt: "2026-04-02T08:00:00.000Z",
    updatedAt: "2026-04-02T08:00:00.000Z",
    userId: "user_123",
    organizationId,
    projectId: null,
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
    coworkerId: null,
    coworker: null,
    name: task.name ?? "New Task",
    description: null,
    status: task.status ?? TaskStatus.DRAFT,
    metadata: null,
    nextRunAt: null,
    credits: 0,
    events: [],
    jobs: [],
    pendingApproval: task.pendingVendorGrantId != null,
    pendingVendorGrantId: task.pendingVendorGrantId ?? null,
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
    getWorkspaceGrant: getWorkspaceGrantMock,
    requestWorkspaceGrantCommitted: requestWorkspaceGrantCommittedMock,
    lockAndGetVendorGrantById: lockAndGetVendorGrantByIdMock,
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
  },
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));

const CREATE_GRANT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function mockCommittedWorkspaceGrant(
  status: VendorGrantStatus,
  created = false,
) {
  const grant = {
    id: CREATE_GRANT_ID,
    status,
  };
  requestWorkspaceGrantCommittedMock.mockResolvedValue({ grant, created });
  lockAndGetVendorGrantByIdMock.mockResolvedValue(grant);
}

describe("createTaskRequestSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults status to DRAFT when omitted", () => {
    const result = createTaskRequestSchema.parse({
      name: "New Task",
      description: "Task description",
      coworkerId: null,
    });

    expect(result.status).toBe(TaskStatus.DRAFT);
  });

  it("accepts READY status", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      coworkerId: "cow_123",
      status: TaskStatus.READY,
    });

    expect(result.status).toBe(TaskStatus.READY);
  });

  it("rejects READY status without coworkerId", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "Ready task",
        description: null,
        coworkerId: null,
        status: TaskStatus.READY,
      });
    }).toThrow();
  });

  it("accepts READY status with whitespace coworkerId at schema layer", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      coworkerId: "  ",
      status: TaskStatus.READY,
    });

    expect(result.status).toBe(TaskStatus.READY);
  });

  it("trims a provided name", () => {
    const result = createTaskRequestSchema.parse({
      name: "  Hello  ",
      description: null,
      coworkerId: null,
    });

    expect(result.name).toBe("Hello");
  });

  it("rejects a whitespace-only name", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "   ",
        description: null,
        coworkerId: null,
      });
    }).toThrow();
  });

  it("accepts a projectId", () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

    const result = createTaskRequestSchema.parse({
      name: "Project task",
      description: null,
      projectId,
      coworkerId: null,
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
            coworkerId: null,
            status,
          });
        }).toThrow();
      }
    });
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
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_123",
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
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
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
        coworkerId: null,
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
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
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
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
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
    getWorkspaceGrantMock.mockResolvedValue(null);
    mockCommittedWorkspaceGrant(VendorGrantStatus.PENDING, true);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Parked Task",
          description: null,
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(requestWorkspaceGrantCommittedMock).toHaveBeenCalledWith(
      expect.objectContaining({ notify: false }),
    );
    expect(lockAndGetVendorGrantByIdMock).toHaveBeenCalledWith(
      CREATE_GRANT_ID,
      expect.anything(),
    );
    expect(notifyWorkspaceApproversOfPendingGrantMock).toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.DRAFT,
          pendingVendorGrantId: CREATE_GRANT_ID,
        }),
      }),
    );
  });

  it("still returns 201 when post-create grant notify fails", async () => {
    mockCommittedWorkspaceGrant(VendorGrantStatus.PENDING, true);
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
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalled();
  });

  it("notifies approvers when parking against an existing pending grant", async () => {
    mockCommittedWorkspaceGrant(VendorGrantStatus.PENDING, false);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second Parked Task",
          description: null,
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(notifyWorkspaceApproversOfPendingGrantMock).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: CREATE_GRANT_ID }),
    );
  });

  it("creates unparked when requestWorkspaceGrant already returns GRANTED", async () => {
    getWorkspaceGrantMock.mockResolvedValue(null);
    mockCommittedWorkspaceGrant(VendorGrantStatus.GRANTED, false);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Race Task",
          description: null,
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
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
    mockCommittedWorkspaceGrant(VendorGrantStatus.GRANTED, false);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Allowed Task",
          description: null,
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(requestWorkspaceGrantCommittedMock).toHaveBeenCalled();
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
    mockCommittedWorkspaceGrant(VendorGrantStatus.DENIED, false);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Denied Task",
          description: null,
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(lockAndGetVendorGrantByIdMock).not.toHaveBeenCalled();
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
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
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
    expect(requestWorkspaceGrantCommittedMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("parks create in personal workspaces when workspace grant is missing", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: null });
    getWorkspaceGrantMock.mockResolvedValue(null);
    mockCommittedWorkspaceGrant(VendorGrantStatus.PENDING, true);
    notifyWorkspaceApproversOfPendingGrantMock.mockResolvedValue(undefined);

    const response = await createDelegatedCoworkerApp().request(
      "http://localhost/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Personal Task",
          description: null,
          coworkerId: null,
          status: TaskStatus.DRAFT,
          origin: TaskEventOrigin.SOKOSUMI,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(requestWorkspaceGrantCommittedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "11111111-1111-7111-8111-111111111111",
        notify: false,
      }),
    );
    expect(taskCreateMock).toHaveBeenCalled();
  });
});
