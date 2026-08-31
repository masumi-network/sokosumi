import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountDeleteTaskSchedule from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  prismaTransactionMock,
  requireTaskOwnershipMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  quarantineFindUniqueMock,
  removeTaskSchedulePlannedOccurrencesMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  quarantineFindUniqueMock: vi.fn(),
  removeTaskSchedulePlannedOccurrencesMock: vi.fn(),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  removeTaskSchedulePlannedOccurrences:
    removeTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

function createUpdatedTask() {
  const owner = { id: "user_123", name: "Owner", image: null };
  return {
    id: "tsk_123",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ownerId: owner.id,
    owner,
    organizationId: "org_123",
    organization: {
      id: "org_123",
      name: "Organization",
      slug: "organization",
      logo: null,
    },
    projectId: null,
    assigneeId: null,
    assignee: null,
    creatorUserId: owner.id,
    creatorUser: owner,
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorOrchestratorId: null,
    creatorOrchestrator: null,
    name: "Scheduled task",
    description: null,
    status: TaskStatus.DRAFT,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    metadata: null,
    nextRunAt: null,
    scheduleRevision: 0,
    events: [],
    jobs: [],
    files: [],
    linksFrom: [],
    linksTo: [],
    share: null,
    workspace: {
      id: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Organization",
        slug: "organization",
        logo: null,
      },
    },
  };
}

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: "org_123",
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_schedule_delete_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });

  app.onError(errorHandler);
  mountDeleteTaskSchedule(app);
  return app;
}

describe("DELETE /tasks/{id}/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.READY,
      workspaceId: WORKSPACE_ID,
      projectId: null,
    });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    quarantineFindUniqueMock.mockResolvedValue(null);
    taskUpdateMock.mockResolvedValue(createUpdatedTask());
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        taskScheduleQuarantine: { findUnique: quarantineFindUniqueMock },
        task: { update: taskUpdateMock },
      }),
    );
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request("http://localhost/tsk_123/schedule", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(requireTaskOwnershipMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("requires audited operator removal for a quarantined schedule", async () => {
    quarantineFindUniqueMock.mockResolvedValue({ id: "quarantine-1" });
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/schedule", {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      WORKSPACE_ID,
      [null],
    );
  });

  it("removes only planned occurrence index rows with the schedule", async () => {
    const response = await createApp().request(
      "http://localhost/tsk_123/schedule",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    expect(removeTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      "tsk_123",
    );
  });
});
