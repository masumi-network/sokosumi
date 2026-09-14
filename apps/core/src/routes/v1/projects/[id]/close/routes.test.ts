import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountProjectCloseRoutes from "./routes";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  cancelProjectCloseOwedWorkMock,
  getProjectCloseStatusMock,
  requestProjectCloseMock,
  retryProjectCloseMock,
} = vi.hoisted(() => ({
  cancelProjectCloseOwedWorkMock: vi.fn(),
  getProjectCloseStatusMock: vi.fn(),
  requestProjectCloseMock: vi.fn(),
  retryProjectCloseMock: vi.fn(),
}));

vi.mock("@/services/project-close-lifecycle.service", () => ({
  cancelProjectCloseOwedWork: cancelProjectCloseOwedWorkMock,
  getProjectCloseStatus: getProjectCloseStatusMock,
  requestProjectClose: requestProjectCloseMock,
  retryProjectClose: retryProjectCloseMock,
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const OPERATION_ID = "33333333-3333-7333-8333-333333333333";

const status = {
  id: OPERATION_ID,
  projectId: PROJECT_ID,
  state: "CLOSING" as const,
  cutoffAt: "2026-09-14T10:00:00.000Z",
  reason: "Campaign completed",
  attempts: 0,
  failure: null,
  completedAt: null,
  projectRevision: 5,
  owedOccurrenceCount: 2,
};

const userAuth: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = userAuth) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_project_close_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  app.onError(errorHandler);
  mountProjectCloseRoutes(app);
  return app;
}

describe("Project close routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestProjectCloseMock.mockResolvedValue(status);
    getProjectCloseStatusMock.mockResolvedValue(status);
    retryProjectCloseMock.mockResolvedValue(status);
    cancelProjectCloseOwedWorkMock.mockResolvedValue(status);
  });

  it("starts a human close with its revision and idempotency key", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/close`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: OPERATION_ID,
          expectedProjectRevision: 4,
          reason: "Campaign completed",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(requestProjectCloseMock).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        actorUserId: "user_123",
      },
      {
        operationId: OPERATION_ID,
        expectedProjectRevision: 4,
        reason: "Campaign completed",
      },
    );
  });

  it("reads current close status", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/close`,
    );

    expect(response.status).toBe(200);
    expect(getProjectCloseStatusMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
  });

  it("requires a reason for retry and cancel-owed recovery", async () => {
    for (const action of ["retry", "cancel-owed"]) {
      const response = await createApp().request(
        `http://localhost/${PROJECT_ID}/close/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId: OPERATION_ID,
            expectedProjectRevision: 5,
            reason: "   ",
          }),
        },
      );
      expect(response.status).toBe(422);
    }
    expect(retryProjectCloseMock).not.toHaveBeenCalled();
    expect(cancelProjectCloseOwedWorkMock).not.toHaveBeenCalled();
  });

  it("rejects coworker credentials for every close mutation", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: null },
    }).request(`http://localhost/${PROJECT_ID}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: OPERATION_ID,
        expectedProjectRevision: 4,
      }),
    });

    expect(response.status).toBe(403);
    expect(requestProjectCloseMock).not.toHaveBeenCalled();
  });
});
