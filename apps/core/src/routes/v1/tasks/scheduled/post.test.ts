import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { TaskScheduleOccurrenceLimitError } from "@/helpers/task-schedule-occurrence-index";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostScheduledTask, {
  createScheduledTaskRequestSchema,
} from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  createScheduledTaskInTransactionMock,
  findScheduledTaskCreateOperationMock,
  mapTaskMock,
  prismaTransactionMock,
  findTaskProjectInWorkspaceMock,
  healProjectBriefingUrlMock,
  resolveTaskDescriptionWithContextMock,
  resolveTaskNameMock,
  requireAssignedOrganizationSeatMock,
  requireScheduledTaskCreatorMock,
  taskFindUniqueOrThrowMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  createScheduledTaskInTransactionMock: vi.fn(),
  findScheduledTaskCreateOperationMock: vi.fn(),
  mapTaskMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  findTaskProjectInWorkspaceMock: vi.fn(),
  healProjectBriefingUrlMock: vi.fn(),
  resolveTaskDescriptionWithContextMock: vi.fn(),
  resolveTaskNameMock: vi.fn(),
  requireAssignedOrganizationSeatMock: vi.fn(),
  requireScheduledTaskCreatorMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: requireAssignedOrganizationSeatMock,
}));

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();
  return { ...actual, mapTask: mapTaskMock };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findUniqueOrThrow: taskFindUniqueOrThrowMock },
    user: { findUnique: userFindUniqueMock },
  },
}));

vi.mock("@/helpers/task-create-context", () => ({
  findTaskProjectInWorkspace: findTaskProjectInWorkspaceMock,
  healProjectBriefingUrl: healProjectBriefingUrlMock,
  resolveTaskDescriptionWithContext: resolveTaskDescriptionWithContextMock,
}));

vi.mock("@/helpers/task-name", () => ({
  resolveTaskName: resolveTaskNameMock,
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: prismaTransactionMock,
}));

vi.mock("@/services/task-schedule-create.service", () => ({
  createScheduledTaskInTransaction: createScheduledTaskInTransactionMock,
  findScheduledTaskCreateOperation: findScheduledTaskCreateOperationMock,
  requireScheduledTaskCreator: requireScheduledTaskCreatorMock,
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

function buildMappedTask() {
  return {
    id: "task_123",
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z",
    ownerId: "user_123",
    organizationId: "org_123",
    projectId: null,
    owner: { id: "user_123", name: "Ada Lovelace", image: null },
    userId: "user_123",
    user: { id: "user_123", name: "Ada Lovelace", image: null },
    organization: { id: "org_123", name: "Acme Labs", slug: "acme-labs" },
    assigneeId: "coworker_123",
    assigneeSokoBotId: null,
    assignee: {
      type: "coworker" as const,
      id: "coworker_123",
      coworker: {
        id: "coworker_123",
        name: "Release Coworker",
        image: null,
        slug: "release-coworker",
      },
    },
    coworkerId: "coworker_123",
    coworker: {
      id: "coworker_123",
      name: "Release Coworker",
      image: null,
      slug: "release-coworker",
    },
    creator: {
      type: "user" as const,
      id: "user_123",
      user: { id: "user_123", name: "Ada Lovelace", image: null },
    },
    sokoBotId: null,
    sokoBot: null,
    name: "Prepare release notes",
    description: null,
    status: TaskStatus.QUEUED,
    metadata: null,
    nextRunAt: "2099-09-24T09:00:00.000Z",
    credits: 0,
    events: [],
    jobs: [],
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    workspace: {
      id: WORKSPACE_ID,
      organizationId: "org_123",
      organization: { id: "org_123", name: "Acme Labs", slug: "acme-labs" },
    },
    share: null,
    links: [],
    files: [],
  };
}

describe("createScheduledTaskRequestSchema", () => {
  it("accepts New Task modal fields with an idempotent v2 schedule request", () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

    expect(
      createScheduledTaskRequestSchema.parse({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "project", projectId },
        description: "Draft the public notes",
        context: {
          brand: true,
          brandSource: "project",
          briefing: true,
          memory: false,
        },
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    ).toMatchObject({
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      source: { type: "project", projectId },
      description: "Draft the public notes",
      context: {
        brand: true,
        brandSource: "project",
        briefing: true,
        memory: false,
      },
      assigneeId: "coworker_123",
      schedule: {
        mode: "once",
        runAt: "2099-09-24T09:00:00.000Z",
      },
    });
  });

  it("rejects a project source without a project id", () => {
    expect(
      createScheduledTaskRequestSchema.safeParse({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "project" },
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });
});

describe("POST /tasks/scheduled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findScheduledTaskCreateOperationMock.mockResolvedValue(null);
    resolveTaskNameMock.mockResolvedValue("Prepare release notes");
    findTaskProjectInWorkspaceMock.mockResolvedValue(null);
    healProjectBriefingUrlMock.mockImplementation(async (project) => project);
    resolveTaskDescriptionWithContextMock.mockImplementation(
      async ({ description }) => description ?? null,
    );
    userFindUniqueMock.mockResolvedValue({
      email: "ada@nmkr.io",
      emailVerified: true,
    });
  });

  function createApp() {
    const app = new OpenAPIHonoWithAuth();
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
    mountPostScheduledTask(app);
    return app;
  }

  it("adapts an interactive Calendar request to one atomic scheduled Task command", async () => {
    const transaction = {};
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback(transaction),
    );
    requireScheduledTaskCreatorMock.mockResolvedValue({
      userContext: {
        source: "session",
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
      actor: { kind: "user", userId: "user_123" },
    });
    createScheduledTaskInTransactionMock.mockResolvedValue("task_123");
    taskFindUniqueOrThrowMock.mockResolvedValue({ id: "task_123" });
    mapTaskMock.mockReturnValue(buildMappedTask());

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "workspace" },
        description: "Draft the public notes",
        assigneeId: "coworker_123",
        context: { brand: false, briefing: false, memory: false },
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(createScheduledTaskInTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        organizationId: "org_123",
        source: { type: "workspace" },
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        name: "Prepare release notes",
        requestFingerprintPayload: {
          name: null,
          description: "Draft the public notes",
          context: { brand: false, briefing: false, memory: false },
        },
      }),
      transaction,
    );
    expect(resolveTaskNameMock).toHaveBeenCalledWith({
      name: undefined,
      description: "Draft the public notes",
    });
    expect(resolveTaskDescriptionWithContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { brand: false, briefing: false, memory: false },
        description: "Draft the public notes",
      }),
    );
    expect(await response.json()).toMatchObject({
      data: { id: "task_123", status: TaskStatus.QUEUED },
    });
  });

  it("rejects an unauthorized creator before resolving an automatic name", async () => {
    requireScheduledTaskCreatorMock.mockRejectedValue(
      forbidden("Scheduled task creation is not allowed"),
    );

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "workspace" },
        description: "Draft the public notes",
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(403);
    expect(resolveTaskNameMock).not.toHaveBeenCalled();
  });

  it("returns an idempotent replay before resolving an automatic name", async () => {
    requireScheduledTaskCreatorMock.mockResolvedValue({
      userContext: {
        source: "session",
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
      actor: { kind: "user", userId: "user_123" },
    });
    findScheduledTaskCreateOperationMock.mockResolvedValue("task_123");
    taskFindUniqueOrThrowMock.mockResolvedValue({ id: "task_123" });
    mapTaskMock.mockReturnValue(buildMappedTask());

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "workspace" },
        description: "Draft the public notes",
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(resolveTaskNameMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("heals a project briefing before the serializable transaction re-reads it", async () => {
    const transaction = {};
    const projectId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const project = {
      id: projectId,
      filesToken: null,
      designMdUrl: null,
      briefing: "Project briefing",
      briefingUrl: null,
      contextMdUrl: null,
    };
    const healedProject = {
      ...project,
      filesToken: "files-token",
      briefingUrl: "https://blob.example/briefing.md",
    };

    prismaTransactionMock.mockImplementation(async (callback) => {
      await callback(transaction);
      return await callback(transaction);
    });
    requireScheduledTaskCreatorMock.mockResolvedValue({
      userContext: {
        source: "session",
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
      actor: { kind: "user", userId: "user_123" },
    });
    findTaskProjectInWorkspaceMock.mockImplementation(
      async (_projectId, _workspaceId, db) => (db ? healedProject : project),
    );
    healProjectBriefingUrlMock.mockResolvedValue(healedProject);
    createScheduledTaskInTransactionMock.mockResolvedValue("task_123");
    taskFindUniqueOrThrowMock.mockResolvedValue({ id: "task_123" });
    mapTaskMock.mockReturnValue(buildMappedTask());

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "project", projectId },
        description: "Draft the public notes",
        assigneeId: "coworker_123",
        context: { brand: false, briefing: true, memory: false },
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(healProjectBriefingUrlMock).toHaveBeenCalledWith(
      project,
      WORKSPACE_ID,
    );
    expect(healProjectBriefingUrlMock).toHaveBeenCalledTimes(1);
    expect(healProjectBriefingUrlMock.mock.invocationCallOrder[0]).toBeLessThan(
      prismaTransactionMock.mock.invocationCallOrder[0],
    );
    expect(findTaskProjectInWorkspaceMock).toHaveBeenNthCalledWith(
      1,
      projectId,
      WORKSPACE_ID,
    );
    expect(findTaskProjectInWorkspaceMock).toHaveBeenNthCalledWith(
      2,
      projectId,
      WORKSPACE_ID,
      transaction,
    );
    expect(findTaskProjectInWorkspaceMock).toHaveBeenNthCalledWith(
      3,
      projectId,
      WORKSPACE_ID,
      transaction,
    );
  });

  it("rejects a non-NMKR user before creating a scheduled task", async () => {
    userFindUniqueMock.mockResolvedValue({
      email: "ada@example.com",
      emailVerified: true,
    });
    const transaction = {};
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback(transaction),
    );
    requireScheduledTaskCreatorMock.mockResolvedValue({
      userContext: {
        source: "session",
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
      actor: { kind: "user", userId: "user_123" },
    });
    createScheduledTaskInTransactionMock.mockResolvedValue("task_123");
    taskFindUniqueOrThrowMock.mockResolvedValue({ id: "task_123" });
    mapTaskMock.mockReturnValue(buildMappedTask());

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "workspace" },
        name: "Prepare release notes",
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(403);
    expect(createScheduledTaskInTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects an unverified NMKR user before creating a scheduled task", async () => {
    userFindUniqueMock.mockResolvedValue({
      email: "ada@nmkr.io",
      emailVerified: false,
    });

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "workspace" },
        name: "Prepare release notes",
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(403);
    expect(createScheduledTaskInTransactionMock).not.toHaveBeenCalled();
  });

  it("returns a bad request when the schedule exceeds the Calendar occurrence limit", async () => {
    const transaction = {};
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback(transaction),
    );
    requireScheduledTaskCreatorMock.mockResolvedValue({
      userContext: {
        source: "session",
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
      actor: { kind: "user", userId: "user_123" },
    });
    createScheduledTaskInTransactionMock.mockRejectedValue(
      new TaskScheduleOccurrenceLimitError(),
    );

    const response = await createApp().request("http://localhost/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        source: { type: "workspace" },
        name: "Prepare release notes",
        assigneeId: "coworker_123",
        schedule: {
          mode: "once",
          runAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    });

    expect(response.status).toBe(400);
  });
});
