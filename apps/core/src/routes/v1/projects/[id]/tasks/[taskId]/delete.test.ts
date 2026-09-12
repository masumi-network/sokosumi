import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountDeleteProjectTask from "./delete.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  lockCalendarScopeMock,
  lockTaskRowsMock,
  projectFindFirstMock,
  prismaTransactionMock,
  refreshTaskSchedulePlannedOccurrencesMock,
  taskFindFirstMock,
  taskFindUniqueMock,
  taskUpdateManyMock,
} = vi.hoisted(() => ({
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  refreshTaskSchedulePlannedOccurrencesMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  refreshTaskSchedulePlannedOccurrences:
    refreshTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    project: { findFirst: projectFindFirstMock },
    task: {
      findFirst: taskFindFirstMock,
      findUnique: taskFindUniqueMock,
      updateMany: taskUpdateManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_CONTEXT_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "tsk_abc";

const ACTIVE_SCHEDULE_METADATA = JSON.stringify({
  version: 2,
  epochId: "11111111-1111-4111-8111-111111111111",
  mode: "recurring",
  createdAt: "2026-09-01T09:00:00.000Z",
  ruleEffectiveFrom: "2026-09-01T09:00:00.000Z",
  timezone: "UTC",
  expr: "0 9 * * *",
  endsMode: "never",
  anchorAt: "2026-09-01T09:00:00.000Z",
  epochReleaseCount: 0,
});

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });

  return app;
}

describe("DELETE /projects/{id}/tasks/{taskId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      name: "P",
      websiteUrl: null,
      logo: null,
      designMdUrl: null,
      designMdExtractionId: null,
      briefing: null,
      briefingUrl: null,
      contextMd: null,
      contextMdUrl: null,
      contextMdUpdatedAt: null,
      contextMdModel: null,
      contextMdUpdatingSince: null,
      contextMdVersion: 0,
      latestUpdateMd: null,
      latestUpdateMdUpdatedAt: null,
      createdAt: new Date("2026-04-03T08:00:00.000Z"),
      updatedAt: new Date("2026-04-03T08:00:00.000Z"),
    });
    taskFindFirstMock.mockResolvedValue({
      pendingVendorGrantId: null,
      status: "DRAFT",
      metadata: null,
      nextRunAt: null,
      workspaceId: WORKSPACE_ID,
    });
    taskFindUniqueMock.mockResolvedValue({
      id: TASK_ID,
      projectId: null,
      status: "DRAFT",
      metadata: null,
      nextRunAt: null,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        task: {
          updateMany: taskUpdateManyMock,
          findUnique: taskFindUniqueMock,
        },
      }),
    );
  });

  it("refreshes planned occurrences after unlinking the task", async () => {
    const app = createApp();
    mountDeleteProjectTask(app);

    const response = await app.request(
      `http://localhost/${PROJECT_ID}/tasks/${TASK_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(refreshTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: TASK_ID,
        projectId: null,
        workspaceId: WORKSPACE_ID,
      }),
    );
  });

  it("rejects unlinking a Task whose schedule series is still active", async () => {
    taskFindFirstMock.mockResolvedValue({
      pendingVendorGrantId: null,
      status: "QUEUED",
      metadata: ACTIVE_SCHEDULE_METADATA,
      nextRunAt: new Date("2026-09-10T09:00:00.000Z"),
      workspaceId: WORKSPACE_ID,
    });
    taskFindUniqueMock.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      status: "QUEUED",
      metadata: ACTIVE_SCHEDULE_METADATA,
      nextRunAt: new Date("2026-09-10T09:00:00.000Z"),
      workspaceId: WORKSPACE_ID,
    });

    const app = createApp();
    app.onError(errorHandler);
    mountDeleteProjectTask(app);

    const response = await app.request(
      `http://localhost/${PROJECT_ID}/tasks/${TASK_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe("schedule_active");
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("checks the schedule guard on the locked row, after both locks", async () => {
    // The pre-transaction read sees no series; a concurrent PUT /schedule arms
    // one before the locks are granted, so only the locked re-read can catch it.
    taskFindUniqueMock.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      status: "QUEUED",
      metadata: ACTIVE_SCHEDULE_METADATA,
      nextRunAt: new Date("2026-09-10T09:00:00.000Z"),
      workspaceId: WORKSPACE_ID,
    });

    const app = createApp();
    app.onError(errorHandler);
    mountDeleteProjectTask(app);

    const response = await app.request(
      `http://localhost/${PROJECT_ID}/tasks/${TASK_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe("schedule_active");
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      select: { metadata: true, nextRunAt: true },
    });
    // Calendar scope lock → Task row lock → locked re-read → guard.
    expect(lockCalendarScopeMock.mock.invocationCallOrder[0]).toBeLessThan(
      lockTaskRowsMock.mock.invocationCallOrder[0],
    );
    expect(lockTaskRowsMock.mock.invocationCallOrder[0]).toBeLessThan(
      taskFindUniqueMock.mock.invocationCallOrder[0],
    );
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountDeleteProjectTask(app);
    const res = await app.request(
      `http://localhost/${PROJECT_ID}/tasks/${TASK_ID}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(403);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });
});
