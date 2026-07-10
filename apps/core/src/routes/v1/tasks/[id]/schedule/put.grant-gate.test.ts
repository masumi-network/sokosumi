import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";

import mountPutTaskSchedule from "./put";

const {
  isVendorGrantEnabledMock,
  mapTaskMock,
  prismaTransactionMock,
  requireDelegatedVendorAutonomyForAssigneeMock,
  requireTaskCollaborationMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  isVendorGrantEnabledMock: vi.fn(),
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireDelegatedVendorAutonomyForAssigneeMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
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
    isVendorGrantEnabled: isVendorGrantEnabledMock,
    requireDelegatedVendorAutonomyForAssignee:
      requireDelegatedVendorAutonomyForAssigneeMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "tsk_schedule_1";

function createSchedulePayload() {
  return {
    mode: "once" as const,
    runAt: "2026-12-24T09:00:00.000Z",
  };
}

function createMappedTask(
  overrides: {
    id?: string;
    status?: TaskStatus;
    nextRunAt?: string | null;
  } = {},
) {
  return {
    id: overrides.id ?? TASK_ID,
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
    coworkerId: "cow_123",
    coworker: null,
    name: "Scheduled task",
    description: "Runs on a cadence",
    status: overrides.status ?? TaskStatus.QUEUED,
    metadata: JSON.stringify({
      version: 1,
      mode: "once",
      scheduledAt: "2026-06-10T12:00:00.000Z",
      runAt: "2026-12-24T09:00:00.000Z",
    }),
    nextRunAt: overrides.nextRunAt ?? "2026-12-24T09:00:00.000Z",
    pendingVendorGrantId: null,
    awaitingVendorApproval: false,
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

function createExistingTask() {
  return {
    id: TASK_ID,
    userId: "user_123",
    organizationId: "org_123",
    workspaceId: WORKSPACE_ID,
    coworkerId: "cow_123",
    status: TaskStatus.READY,
    pendingVendorGrantId: null,
  };
}

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

  mountPutTaskSchedule(app as unknown as OpenAPIHonoWithAuth);

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

  mountPutTaskSchedule(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("PUT /tasks/{id}/schedule grant gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"));
    isVendorGrantEnabledMock.mockReturnValue(true);
    requireDelegatedVendorAutonomyForAssigneeMock.mockResolvedValue(undefined);
    requireTaskCollaborationMock.mockResolvedValue(createExistingTask());
    mapTaskMock.mockImplementation((task) =>
      createMappedTask({
        id: task?.id ?? TASK_ID,
        status: task?.status ?? TaskStatus.QUEUED,
        nextRunAt:
          task?.nextRunAt instanceof Date
            ? task.nextRunAt.toISOString()
            : (task?.nextRunAt ?? "2026-12-24T09:00:00.000Z"),
      }),
    );
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        task: {
          update: taskUpdateMock,
        },
      }),
    );
    taskUpdateMock.mockResolvedValue(
      createMappedTask({
        status: TaskStatus.QUEUED,
        nextRunAt: "2026-12-24T09:00:00.000Z",
      }),
    );
  });

  it("does not grant-gate normal user session schedule saves", async () => {
    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSchedulePayload()),
    });

    expect(response.status).toBe(200);
    expect(
      requireDelegatedVendorAutonomyForAssigneeMock,
    ).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalled();
  });

  it("returns grant_denied when delegated schedule lacks autonomy", async () => {
    requireDelegatedVendorAutonomyForAssigneeMock.mockRejectedValue(
      forbidden("Vendor access is required for this workspace", {
        kind: "grant_denied",
      }),
    );

    const app = createDelegatedApp();
    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSchedulePayload()),
    });

    expect(response.status).toBe(403);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("returns grant_denied when delegated schedule hits a revoked grant", async () => {
    requireDelegatedVendorAutonomyForAssigneeMock.mockRejectedValue(
      forbidden("Vendor access was denied for this workspace", {
        kind: "grant_denied",
      }),
    );

    const app = createDelegatedApp();
    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSchedulePayload()),
    });

    expect(response.status).toBe(403);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("saves the schedule when delegated autonomy is already granted", async () => {
    const app = createDelegatedApp();
    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSchedulePayload()),
    });

    expect(response.status).toBe(200);
    expect(requireDelegatedVendorAutonomyForAssigneeMock).toHaveBeenCalledWith({
      actorVendorId: TEST_VENDOR_ID,
      userId: "user_123",
      workspaceId: WORKSPACE_ID,
      assigneeCoworkerId: "cow_123",
    });
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          nextRunAt: expect.any(Date),
        }),
      }),
    );
  });
});
