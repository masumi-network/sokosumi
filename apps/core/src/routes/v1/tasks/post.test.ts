import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPostTask, { createTaskRequestSchema } from "./post";

const {
  generateTaskNameMock,
  mapTaskMock,
  projectFindFirstMock,
  prismaTransactionMock,
  requireTaskAssignableCoworkerMock,
  taskCreateMock,
} = vi.hoisted(() => ({
  generateTaskNameMock: vi.fn(),
  mapTaskMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
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

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
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

  it("trims a provided name", () => {
    const result = createTaskRequestSchema.parse({
      name: "  Hello  ",
      description: null,
      coworkerId: null,
    });

    expect(result.name).toBe("Hello");
  });

  it("rejects a whitespace-only name", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "   ",
        description: null,
        coworkerId: null,
      });
    }).toThrow();
  });

  it("accepts a projectId", () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

    const result = createTaskRequestSchema.parse({
      name: "Project task",
      description: null,
      projectId,
      coworkerId: null,
    });

    expect(result.projectId).toBe(projectId);
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
        role: "user",
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
    vi.clearAllMocks();
    generateTaskNameMock.mockResolvedValue("Generated name");
    taskCreateMock.mockResolvedValue({ id: "tsk_123" });
    mapTaskMock.mockReturnValue({
      id: "tsk_123",
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
      coworkerId: null,
      coworker: null,
      name: "New Task",
      description: null,
      status: TaskStatus.DRAFT,
      metadata: null,
      nextRunAt: null,
      awaitingVendorApproval: false,
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
          project: {
            findFirst: projectFindFirstMock,
          },
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
          projectId: null,
        }),
      }),
    );
  });

  it("verifies and persists a project assignment on create", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue({ id: projectId });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Project Task",
        description: null,
        projectId,
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: projectId,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: { id: true },
    });
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId,
        }),
      }),
    );
  });

  it("rejects a project from outside the active workspace", async () => {
    const app = createApp();
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    projectFindFirstMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Project Task",
        description: null,
        projectId,
        coworkerId: null,
        status: TaskStatus.DRAFT,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("generates a name from the description when name is omitted", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Build landing page",
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Generated name" }),
      }),
    );
  });

  it("uses a provided name verbatim without generating", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My task",
        description: "Build landing page",
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(generateTaskNameMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "My task" }),
      }),
    );
  });
});
