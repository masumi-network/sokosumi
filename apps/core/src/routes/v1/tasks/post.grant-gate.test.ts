import { OpenAPIHono } from "@hono/zod-openapi";
import {
  TaskEventOrigin,
  VendorGrantScope,
  VendorGrantStatus,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";

import mountPostTask from "./post";

const {
  coworkerFindUniqueMock,
  generateTaskNameMock,
  getDelegatedVendorGrantStateMock,
  hasAutonomyGrantMock,
  isVendorGrantEnabledMock,
  mapTaskMock,
  prismaTransactionMock,
  requireTaskAssignableCoworkerMock,
  serializableTransactionMock,
  taskCreateMock,
  vendorGrantFindUniqueMock,
  vendorGrantUpsertMock,
} = vi.hoisted(() => ({
  coworkerFindUniqueMock: vi.fn(),
  generateTaskNameMock: vi.fn(),
  getDelegatedVendorGrantStateMock: vi.fn(),
  hasAutonomyGrantMock: vi.fn(),
  isVendorGrantEnabledMock: vi.fn(),
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  serializableTransactionMock: vi.fn(),
  taskCreateMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  vendorGrantUpsertMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
}));

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();

  return {
    ...actual,
    mapTask: mapTaskMock,
  };
});

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();

  return {
    ...actual,
    getDelegatedVendorGrantState: getDelegatedVendorGrantStateMock,
    hasAutonomyGrant: hasAutonomyGrantMock,
    isVendorGrantEnabled: isVendorGrantEnabledMock,
  };
});

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    coworker: {
      findUnique: coworkerFindUniqueMock,
    },
    vendorGrant: {
      findUnique: vendorGrantFindUniqueMock,
    },
  },
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const GRANT_ID = "01960001-0001-7001-8001-000000000099";

function createDelegatedApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      delegation: {
        userId: "user_123",
        organizationId: "org_123",
      },
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountPostTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createUserApp() {
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
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountPostTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createTaskPayload() {
  return {
    name: "Grant-gated task",
    description: "Needs vendor approval",
    coworkerId: "cow_assignee",
    status: TaskStatus.READY,
    origin: TaskEventOrigin.SOKOSUMI,
  };
}

function createMappedTask(
  overrides: {
    id?: string;
    pendingVendorGrantId?: string | null;
    awaitingVendorApproval?: boolean;
  } = {},
) {
  return {
    id: overrides.id ?? "tsk_123",
    createdAt: "2026-04-02T08:00:00.000Z",
    updatedAt: "2026-04-02T08:00:00.000Z",
    userId: "user_123",
    organizationId: "org_123",
    projectId: null,
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    organization: {
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
    },
    coworkerId: "cow_assignee",
    coworker: null,
    name: "Grant-gated task",
    description: "Needs vendor approval",
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
    pendingVendorGrantId: overrides.pendingVendorGrantId ?? null,
    awaitingVendorApproval: overrides.awaitingVendorApproval ?? false,
    credits: 0,
    events: [],
    jobs: [],
    workspace: {
      id: WORKSPACE_ID,
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    share: null,
    links: [],
  };
}

describe("POST /tasks vendor grant gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVendorGrantEnabledMock.mockReturnValue(true);
    generateTaskNameMock.mockResolvedValue("Grant-gated task");
    requireTaskAssignableCoworkerMock.mockResolvedValue(undefined);
    coworkerFindUniqueMock.mockResolvedValue({ vendorId: TEST_VENDOR_ID });
    mapTaskMock.mockImplementation((task) =>
      createMappedTask({
        id: task.id,
        pendingVendorGrantId: task.pendingVendorGrantId ?? null,
        awaitingVendorApproval: task.pendingVendorGrantId != null,
      }),
    );
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          task: {
            create: taskCreateMock,
          },
        });
      },
    );
  });

  it("creates normally when the grant flag is disabled", async () => {
    isVendorGrantEnabledMock.mockReturnValue(false);
    taskCreateMock.mockResolvedValue({
      id: "tsk_123",
      pendingVendorGrantId: null,
    });

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(vendorGrantFindUniqueMock).not.toHaveBeenCalled();
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("does not grant-gate normal user session task creation", async () => {
    taskCreateMock.mockResolvedValue({
      id: "tsk_123",
      pendingVendorGrantId: null,
    });

    const app = createUserApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(vendorGrantFindUniqueMock).not.toHaveBeenCalled();
    expect(hasAutonomyGrantMock).not.toHaveBeenCalled();
    expect(serializableTransactionMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_123",
          workspaceId: WORKSPACE_ID,
          pendingVendorGrantId: null,
        }),
      }),
    );
  });

  it("returns grant_denied when an existing grant is denied", async () => {
    getDelegatedVendorGrantStateMock.mockRejectedValue(
      forbidden("Vendor access was denied for this workspace", {
        kind: "grant_denied",
      }),
    );

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(403);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("creates immediately when autonomy is already granted", async () => {
    getDelegatedVendorGrantStateMock.mockResolvedValue({
      scope: VendorGrantScope.VENDOR,
      existingGrant: {
        id: GRANT_ID,
        status: VendorGrantStatus.GRANTED,
      },
      granted: true,
    });
    taskCreateMock.mockResolvedValue({
      id: "tsk_123",
      pendingVendorGrantId: null,
    });

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(hasAutonomyGrantMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingVendorGrantId: null,
        }),
      }),
    );
  });

  it("parks the task and upserts a pending grant when autonomy is missing", async () => {
    getDelegatedVendorGrantStateMock.mockResolvedValue({
      scope: VendorGrantScope.VENDOR,
      existingGrant: null,
      granted: false,
    });
    serializableTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        vendorGrant: {
          upsert: vendorGrantUpsertMock,
        },
        task: {
          create: taskCreateMock,
        },
      });
    });
    vendorGrantUpsertMock.mockResolvedValue({
      id: GRANT_ID,
      status: VendorGrantStatus.PENDING,
    });
    taskCreateMock.mockResolvedValue({
      id: "tsk_parked",
      pendingVendorGrantId: GRANT_ID,
    });

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(vendorGrantUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vendorId_userId_workspaceId_scope: {
            vendorId: TEST_VENDOR_ID,
            userId: "user_123",
            workspaceId: WORKSPACE_ID,
            scope: VendorGrantScope.VENDOR,
          },
        },
        create: expect.objectContaining({
          status: VendorGrantStatus.PENDING,
        }),
      }),
    );
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingVendorGrantId: GRANT_ID,
        }),
      }),
    );
  });

  it("uses WORKSPACE scope when the assignee belongs to another vendor", async () => {
    getDelegatedVendorGrantStateMock.mockResolvedValue({
      scope: VendorGrantScope.WORKSPACE,
      existingGrant: null,
      granted: false,
    });
    serializableTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        vendorGrant: {
          upsert: vendorGrantUpsertMock,
        },
        task: {
          create: taskCreateMock,
        },
      });
    });
    vendorGrantUpsertMock.mockResolvedValue({
      id: GRANT_ID,
      status: VendorGrantStatus.PENDING,
    });
    taskCreateMock.mockResolvedValue({
      id: "tsk_parked",
      pendingVendorGrantId: GRANT_ID,
    });

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(getDelegatedVendorGrantStateMock).toHaveBeenCalledWith({
      actorVendorId: TEST_VENDOR_ID,
      userId: "user_123",
      workspaceId: WORKSPACE_ID,
      assigneeCoworkerId: "cow_assignee",
    });
    expect(vendorGrantUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vendorId_userId_workspaceId_scope: {
            vendorId: TEST_VENDOR_ID,
            userId: "user_123",
            workspaceId: WORKSPACE_ID,
            scope: VendorGrantScope.WORKSPACE,
          },
        },
      }),
    );
  });

  it("re-parks a task against an existing pending grant without reopening it", async () => {
    getDelegatedVendorGrantStateMock.mockResolvedValue({
      scope: VendorGrantScope.VENDOR,
      existingGrant: {
        id: GRANT_ID,
        status: VendorGrantStatus.PENDING,
      },
      granted: false,
    });
    serializableTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        vendorGrant: {
          upsert: vendorGrantUpsertMock,
        },
        task: {
          create: taskCreateMock,
        },
      });
    });
    vendorGrantUpsertMock.mockResolvedValue({
      id: GRANT_ID,
      status: VendorGrantStatus.PENDING,
    });
    taskCreateMock.mockResolvedValue({
      id: "tsk_parked_2",
      pendingVendorGrantId: GRANT_ID,
    });

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(vendorGrantUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vendorId_userId_workspaceId_scope: {
            vendorId: TEST_VENDOR_ID,
            userId: "user_123",
            workspaceId: WORKSPACE_ID,
            scope: VendorGrantScope.VENDOR,
          },
        },
        update: {},
        create: expect.objectContaining({
          status: VendorGrantStatus.PENDING,
        }),
      }),
    );
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingVendorGrantId: GRANT_ID,
        }),
      }),
    );
  });

  it("looks up and creates grants in the current workspace only", async () => {
    getDelegatedVendorGrantStateMock.mockResolvedValue({
      scope: VendorGrantScope.VENDOR,
      existingGrant: null,
      granted: false,
    });
    serializableTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        vendorGrant: {
          upsert: vendorGrantUpsertMock,
        },
        task: {
          create: taskCreateMock,
        },
      });
    });
    vendorGrantUpsertMock.mockResolvedValue({
      id: GRANT_ID,
      status: VendorGrantStatus.PENDING,
    });
    taskCreateMock.mockResolvedValue({
      id: "tsk_parked",
      pendingVendorGrantId: GRANT_ID,
    });

    const app = createDelegatedApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload()),
    });

    expect(response.status).toBe(201);
    expect(getDelegatedVendorGrantStateMock).toHaveBeenCalledWith({
      actorVendorId: TEST_VENDOR_ID,
      userId: "user_123",
      workspaceId: WORKSPACE_ID,
      assigneeCoworkerId: "cow_assignee",
    });
    expect(vendorGrantUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vendorId_userId_workspaceId_scope: {
            vendorId: TEST_VENDOR_ID,
            userId: "user_123",
            workspaceId: WORKSPACE_ID,
            scope: VendorGrantScope.VENDOR,
          },
        },
      }),
    );
  });
});
