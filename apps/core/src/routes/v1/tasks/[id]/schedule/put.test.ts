import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPutTaskSchedule from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  prismaTransactionMock,
  taskUpdateMock,
  requireTaskCollaborationMock,
  canUseOrganizationWorkstationMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  canUseOrganizationWorkstationMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    canUseOrganizationWorkstation: (...args: unknown[]) =>
      canUseOrganizationWorkstationMock(...args),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    task: {
      update: taskUpdateMock,
    },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "tsk_123";

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
    c.set("requestId", "req_schedule_put_test");
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
  mountPutTaskSchedule(app);
  return app;
}

describe("PUT /tasks/{id}/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canUseOrganizationWorkstationMock.mockResolvedValue(true);
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      assigneeId: "cow_123",
      ownerId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
    });
    prismaTransactionMock.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== "function") {
        return undefined;
      }
      return await (
        callback as (tx: {
          task: { update: typeof taskUpdateMock };
        }) => Promise<unknown>
      )({
        task: { update: taskUpdateMock },
      });
    });
  });

  it("returns 403 when the member has no organization workstation", async () => {
    canUseOrganizationWorkstationMock.mockResolvedValue(false);

    const app = createApp();
    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "once",
        runAt: "2099-01-01T09:00:00.000Z",
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "once",
        runAt: "2099-01-01T09:00:00.000Z",
      }),
    });

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
