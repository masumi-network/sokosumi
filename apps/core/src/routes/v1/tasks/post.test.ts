import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPostTask, { createTaskRequestSchema } from "./post";

const {
  mapTaskMock,
  prismaTransactionMock,
  requireTaskAssignableCoworkerMock,
  taskCreateMock,
} = vi.hoisted(() => ({
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  taskCreateMock: vi.fn(),
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

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

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
    taskCreateMock.mockResolvedValue({ id: "tsk_123" });
    mapTaskMock.mockReturnValue({
      id: "tsk_123",
      createdAt: "2026-04-02T08:00:00.000Z",
      updatedAt: "2026-04-02T08:00:00.000Z",
      userId: "user_123",
      organizationId: "org_123",
      coworkerId: null,
      name: "New Task",
      description: null,
      status: TaskStatus.DRAFT,
      credits: 0,
      events: [],
      jobs: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: "org_123",
        organization: {
          id: "org_123",
          name: "Acme Labs",
          slug: "acme-labs",
        },
      },
      share: null,
      links: [],
    });
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
        }),
      }),
    );
  });
});
