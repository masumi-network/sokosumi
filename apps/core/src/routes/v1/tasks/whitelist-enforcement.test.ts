import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPatchTask from "./[id]/patch";
import mountPostTask from "./post";

const {
  prismaTransactionMock,
  requireAssignableCoworkerMock,
  requireUserTaskAccessMock,
  mapTaskMock,
  validateTaskCoworkerAssignmentMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireAssignableCoworkerMock: vi.fn(),
  requireUserTaskAccessMock: vi.fn(),
  mapTaskMock: vi.fn((task: unknown) => task),
  validateTaskCoworkerAssignmentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireAssignableCoworker: requireAssignableCoworkerMock,
  requireUserTaskAccess: requireUserTaskAccessMock,
}));

vi.mock("@/helpers/task", () => ({
  mapTask: mapTaskMock,
  validateTaskCoworkerAssignment: validateTaskCoworkerAssignmentMock,
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });

    return await next();
  });

  mountPostTask(app as unknown as OpenAPIHonoWithAuth);
  mountPatchTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("task coworker whitelist enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects task creation when coworker is not whitelisted", async () => {
    const tx = {
      task: {
        create: vi.fn(),
      },
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });

    requireAssignableCoworkerMock.mockRejectedValue(
      new HTTPException(404, { message: "Coworker not found" }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Whitelist check",
        coworkerId: "cow_123",
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(404);
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it("rejects task update when coworker is not whitelisted", async () => {
    const tx = {
      task: {
        update: vi.fn(),
      },
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });

    requireUserTaskAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.READY,
      coworkerId: null,
    });
    requireAssignableCoworkerMock.mockRejectedValue(
      new HTTPException(404, { message: "Coworker not found" }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coworkerId: "cow_123",
      }),
    });

    expect(response.status).toBe(404);
    expect(tx.task.update).not.toHaveBeenCalled();
  });
});
