import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { projectFindFirstMock, taskFindFirstMock, taskUpdateManyMock } =
  vi.hoisted(() => ({
    projectFindFirstMock: vi.fn(),
    taskFindFirstMock: vi.fn(),
    taskUpdateManyMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    task: {
      findFirst: taskFindFirstMock,
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
