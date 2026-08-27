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

const { prismaTransactionMock, requireTaskOwnershipMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskOwnershipMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

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
    });
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
});
