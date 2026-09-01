/**
 * SOK-943: Assign tasks to the owner's PA on the orchestrator assignee rail.
 * Covers POST/PATCH assign, shadow remap, owner-only assignability, picker
 * listing, GET persistence (OpenAPI identity), and taskboard wake on assign.
 */
import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { mapTask } from "@/helpers/task";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import type { TaskWithIncludes } from "@/types/task";

import mountGetTaskById from "./[id]/get";
import mountPatchTask, { patchTaskRequestSchema } from "./[id]/patch";
import mountPostTask, { createTaskRequestSchema } from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  coworkerFindFirstMock,
  ensureProjectFilesTokenMock,
  generateTaskNameMock,
  getForUserMock,
  getSokoBotAvailabilityMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  proactiveGateMock,
  projectFindFirstMock,
  projectUpdateManyMock,
  prismaTransactionMock,
  requireMutableTaskOwnershipMock,
  requireTaskReadMock,
  sokoBotFindFirstMock,
  sokoBotFindManyMock,
  startTurnMock,
  reconcileTurnMock,
  taskCreateMock,
  taskEventFindManyMock,
  taskFindFirstMock,
  taskFindManyMock,
  taskFindUniqueOrThrowMock,
  taskUpdateMock,
  uploadProjectBriefingFileMock,
  userFindUniqueMock,
  watchUpsertMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  ensureProjectFilesTokenMock: vi.fn(),
  generateTaskNameMock: vi.fn(),
  getForUserMock: vi.fn(),
  getSokoBotAvailabilityMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  proactiveGateMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireMutableTaskOwnershipMock: vi.fn(),
  requireTaskReadMock: vi.fn(),
  sokoBotFindFirstMock: vi.fn(),
  sokoBotFindManyMock: vi.fn(),
  startTurnMock: vi.fn(),
  reconcileTurnMock: vi.fn(),
  taskCreateMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFindUniqueOrThrowMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  uploadProjectBriefingFileMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  watchUpsertMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/access-control")>();
  return {
    ...actual,
    requireTaskReadForRouteVars: requireTaskReadMock,
    requireMutableTaskOwnership: requireMutableTaskOwnershipMock,
  };
});

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      SOKO_BOT_ENABLED: true,
    }),
  };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: getSokoBotAvailabilityMock,
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/design-md-effective", () => ({
  resolveEffectiveDesignMd: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/project-files-blob", () => ({
  ensureProjectFilesToken: ensureProjectFilesTokenMock,
  uploadProjectBriefingFile: uploadProjectBriefingFileMock,
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));

vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class SokoBotBusyError extends Error {},
  sokoBotControlPlane: {
    getForUser: getForUserMock,
    startTurn: startTurnMock,
    reconcileTurn: reconcileTurnMock,
  },
}));

vi.mock("@/services/soko-bot-proactive.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-proactive.service")
    >();
  return {
    ...actual,
    proactiveGate: proactiveGateMock,
    ensureSystemSchedules: vi.fn().mockResolvedValue(undefined),
    findAttentionItems: vi.fn().mockResolvedValue([]),
    followUpsBlock: vi.fn().mockResolvedValue([]),
    stampNudges: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: {
      ...actual.workspaceRepository,
      resolveWorkspaceForContext: vi.fn().mockResolvedValue({
        id: "11111111-1111-7111-8111-111111111111",
        userId: "user_owner",
        organizationId: "org_123",
      }),
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    project: {
      findFirst: projectFindFirstMock,
      updateMany: projectUpdateManyMock,
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    sokoBot: {
      findMany: sokoBotFindManyMock,
    },
    sokoBotDelegation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    task: {
      findMany: taskFindManyMock,
    },
    taskEvent: {
      findMany: taskEventFindManyMock,
    },
    sokoBotTaskWatch: {
      upsert: watchUpsertMock,
    },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const USER_ID = "user_owner";
const OTHER_USER_ID = "user_other";
const ORG_ID = "org_123";
const ORCHESTRATOR_ID = "01960001-0001-7001-8001-000000000099";
const SHADOW_COWORKER_ID = "550e8400-e29b-41d4-a716-446655440077";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440001";

function buildOwnerApp(
  mount: (app: OpenAPIHonoWithAuth) => void,
  userId = USER_ID,
) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: ORG_ID,
      role: "user",
    } as AuthVariables["authContext"]);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: ORG_ID,
    });
    return next();
  });
  mount(app);
  return app;
}

function orchestratorRelation() {
  return {
    id: ORCHESTRATOR_ID,
    name: "Ada",
    avatarImageUrl: null,
    avatarSeed: `orb:${USER_ID}`,
    userId: USER_ID,
    archivedAt: null,
    deletedAt: null,
    user: { id: USER_ID, name: "Owner User", image: null },
  };
}

function buildSokoBotForPicker() {
  return {
    id: ORCHESTRATOR_ID,
    name: "Ada",
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    avatarImageUrl: null,
    avatarSeed: `orb:${USER_ID}`,
    personalityTone: null,
    personalityDetail: null,
    personalityStyle: null,
    status: "IDLE" as const,
    runtimeVersion: null,
    lastSandboxStatus: null,
    memoryVersion: 0,
    memoryHash: null,
    lastActivityAt: null,
    lastTurnAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveTurnFailures: 0,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    archivedAt: null,
    deletedAt: null,
    user: { id: USER_ID, name: "Owner User" },
    memoryRevisions: [],
    coworker: null,
  };
}

function buildTaskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    ownerId: USER_ID,
    organizationId: ORG_ID,
    projectId: null,
    assigneeId: null,
    assigneeOrchestratorId: ORCHESTRATOR_ID,
    assignee: null,
    assigneeOrchestrator: orchestratorRelation(),
    creatorUserId: USER_ID,
    creatorCoworkerId: null,
    creatorOrchestratorId: null,
    creatorUser: { id: USER_ID, name: "Owner User", image: null },
    creatorCoworker: null,
    creatorOrchestrator: null,
    orchestratorId: null,
    orchestrator: null,
    owner: { id: USER_ID, name: "Owner User", image: null },
    organization: { id: ORG_ID, name: "Acme", slug: "acme" },
    name: "PA task",
    description: null,
    status: TaskStatus.READY,
    metadata: null,
    nextRunAt: null,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    workspaceId: WORKSPACE_ID,
    workspace: {
      id: WORKSPACE_ID,
      organizationId: ORG_ID,
      organization: { id: ORG_ID, name: "Acme", slug: "acme" },
    },
    events: [],
    jobs: [],
    links: [],
    linksFrom: [],
    linksTo: [],
    files: [],
    share: null,
    ...overrides,
  };
}

function buildTransactionClient() {
  return {
    project: { findFirst: projectFindFirstMock },
    coworker: { findFirst: coworkerFindFirstMock },
    sokoBot: { findFirst: sokoBotFindFirstMock },
    task: {
      create: taskCreateMock,
      update: taskUpdateMock,
      findFirst: taskFindFirstMock,
      findUniqueOrThrow: taskFindUniqueOrThrowMock,
    },
  };
}

describe("SOK-943 PA orchestrator task assignee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateTaskNameMock.mockResolvedValue("Generated task");
    ensureProjectFilesTokenMock.mockResolvedValue("project_files_token");
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    uploadProjectBriefingFileMock.mockResolvedValue(
      "https://store.public.blob.vercel-storage.com/brief.md",
    );
    workspaceFindUniqueMock.mockResolvedValue({ id: WORKSPACE_ID });
    getSokoBotAvailabilityMock.mockResolvedValue({ disabled: false });
    userFindUniqueMock.mockResolvedValue({
      email: "owner@nmkr.io",
      emailVerified: true,
    });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    requireMutableTaskOwnershipMock.mockImplementation(async () =>
      buildTaskRecord({
        assigneeOrchestratorId: null,
        assigneeOrchestrator: null,
        status: TaskStatus.DRAFT,
      }),
    );
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 0, limit: 20 });
    startTurnMock.mockResolvedValue({
      turnId: "turn_1",
      status: "RUNNING",
      reconciliationLeaseToken: "lease",
    });
    reconcileTurnMock.mockResolvedValue(undefined);
    watchUpsertMock.mockResolvedValue({});
    taskEventFindManyMock.mockResolvedValue([]);
    sokoBotFindManyMock.mockResolvedValue([]);
  });

  describe("request schemas", () => {
    it("accepts READY create with assigneeOrchestratorId only", () => {
      const result = createTaskRequestSchema.parse({
        name: "Hand off",
        description: null,
        assigneeOrchestratorId: ORCHESTRATOR_ID,
        status: TaskStatus.READY,
      });

      expect(result.assigneeOrchestratorId).toBe(ORCHESTRATOR_ID);
      expect(result.assigneeId).toBeUndefined();
    });

    it("rejects both assignee rails on create", () => {
      expect(() =>
        createTaskRequestSchema.parse({
          name: "Conflict",
          assigneeId: "cow_1",
          assigneeOrchestratorId: ORCHESTRATOR_ID,
        }),
      ).toThrow();
    });

    it("accepts PATCH with assigneeOrchestratorId only", () => {
      const result = patchTaskRequestSchema.parse({
        assigneeOrchestratorId: ORCHESTRATOR_ID,
      });
      expect(result.assigneeOrchestratorId).toBe(ORCHESTRATOR_ID);
    });
  });

  describe("POST /tasks assigneeOrchestratorId", () => {
    beforeEach(() => {
      sokoBotFindFirstMock.mockResolvedValue({
        id: ORCHESTRATOR_ID,
        userId: USER_ID,
      });
      taskCreateMock.mockResolvedValue({ id: TASK_ID });
      taskFindUniqueOrThrowMock.mockResolvedValue(buildTaskRecord());
      prismaTransactionMock.mockImplementation(async (callback) =>
        callback(buildTransactionClient()),
      );
    });

    it("owner assigns READY task to their PA on the orchestrator rail", async () => {
      const app = buildOwnerApp(mountPostTask);
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "PA task",
          description: null,
          assigneeOrchestratorId: ORCHESTRATOR_ID,
          status: TaskStatus.READY,
        }),
      });

      expect(response.status).toBe(201);
      expect(taskCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: null,
            assigneeOrchestratorId: ORCHESTRATOR_ID,
          }),
        }),
      );
      const body = await response.json();
      expect(body.data.assignee).toEqual({
        type: "orchestrator",
        id: ORCHESTRATOR_ID,
        orchestrator: expect.objectContaining({
          id: ORCHESTRATOR_ID,
          name: "Ada",
          owner: expect.objectContaining({ id: USER_ID }),
        }),
      });
      expect(body.data.assigneeId).toBeNull();
      expect(body.data.assigneeOrchestratorId).toBe(ORCHESTRATOR_ID);
    });

    it("remaps shadow PA coworker assigneeId to orchestrator on create", async () => {
      coworkerFindFirstMock.mockResolvedValue({
        sokoBotId: ORCHESTRATOR_ID,
        sokoBot: {
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          archivedAt: null,
          deletedAt: null,
        },
      });
      taskFindUniqueOrThrowMock.mockResolvedValue(buildTaskRecord());

      const app = buildOwnerApp(mountPostTask);
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Shadow remap",
          description: null,
          assigneeId: SHADOW_COWORKER_ID,
          status: TaskStatus.READY,
        }),
      });

      expect(response.status).toBe(201);
      expect(taskCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: null,
            assigneeOrchestratorId: ORCHESTRATOR_ID,
          }),
        }),
      );
    });

    it("returns 403 when a non-owner assigns the owner PA", async () => {
      sokoBotFindFirstMock.mockResolvedValue({
        id: ORCHESTRATOR_ID,
        userId: USER_ID,
      });
      prismaTransactionMock.mockImplementation(async (callback) =>
        callback(buildTransactionClient()),
      );

      const app = buildOwnerApp(mountPostTask, OTHER_USER_ID);

      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Forbidden",
          description: null,
          assigneeOrchestratorId: ORCHESTRATOR_ID,
          status: TaskStatus.READY,
        }),
      });

      expect(response.status).toBe(403);
      expect(taskCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /tasks/{id} assigneeOrchestratorId", () => {
    beforeEach(() => {
      sokoBotFindFirstMock.mockResolvedValue({
        id: ORCHESTRATOR_ID,
        userId: USER_ID,
      });
      taskFindFirstMock.mockResolvedValue(
        buildTaskRecord({
          assigneeOrchestratorId: null,
          assigneeOrchestrator: null,
          status: TaskStatus.DRAFT,
        }),
      );
      taskUpdateMock.mockResolvedValue(
        buildTaskRecord({ status: TaskStatus.READY }),
      );
      taskFindUniqueOrThrowMock.mockResolvedValue(
        buildTaskRecord({ status: TaskStatus.READY }),
      );
      prismaTransactionMock.mockImplementation(async (callback) =>
        callback(buildTransactionClient()),
      );
    });

    it("owner PATCH assigns orchestrator and clears coworker FK", async () => {
      const app = buildOwnerApp(mountPatchTask);
      const response = await app.request(`http://localhost/${TASK_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assigneeOrchestratorId: ORCHESTRATOR_ID,
        }),
      });

      expect(response.status).toBe(200);
      expect(taskUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: null,
            assigneeOrchestratorId: ORCHESTRATOR_ID,
          }),
        }),
      );
    });
  });

  describe("GET /tasks/{id} OpenAPI identity", () => {
    it("maps orchestrator assignee through taskSchema", async () => {
      const task = buildTaskRecord();
      requireTaskReadMock.mockResolvedValue(task);

      const app = buildOwnerApp(mountGetTaskById);
      const response = await app.request(`http://localhost/${TASK_ID}`);

      expect(response.status).toBe(200);
      const body = await response.json();
      const expected = taskSchema.parse(
        mapTask(task as unknown as TaskWithIncludes),
      );
      expect(body.data.assignee).toEqual(expected.assignee);
      expect(body.data.assigneeOrchestratorId).toBe(ORCHESTRATOR_ID);
      expect(body.data.assigneeId).toBeNull();
    });
  });

  describe("GET /soko-bots/me picker", () => {
    it("returns the owner PA for task assignee picker", async () => {
      getForUserMock.mockResolvedValue(buildSokoBotForPicker());

      const { default: sokoBotsRouter } = await import("../soko-bots/index");
      const app = new OpenAPIHonoWithAuth();
      app.onError(errorHandler);
      app.use("*", async (c, next) => {
        c.set("isAuthenticated", true);
        c.set("authContext", {
          actor: "user",
          userId: USER_ID,
          organizationId: ORG_ID,
          role: "user",
        } as AuthVariables["authContext"]);
        c.set("workspaceContext", {
          workspaceId: WORKSPACE_ID,
          userId: null,
          organizationId: ORG_ID,
        });
        return next();
      });
      app.route("/soko-bots", sokoBotsRouter);

      const response = await app.request("http://localhost/soko-bots/me");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.sokoBot).toEqual(
        expect.objectContaining({
          id: ORCHESTRATOR_ID,
          name: "Ada",
        }),
      );
    });
  });

  describe("taskboard sync after orchestrator-only assign", () => {
    it("starts an owner-session turn for READY orchestrator-assigned work", async () => {
      const { SokoBotTaskboardSyncService } = await import(
        "@/services/soko-bot-taskboard-sync.service"
      );

      sokoBotFindManyMock.mockResolvedValue([
        {
          id: ORCHESTRATOR_ID,
          name: "Ada",
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          followWholeBoard: false,
          ingestTimezone: "UTC",
          coworker: { id: SHADOW_COWORKER_ID },
          memoryRevisions: [{ markdown: "" }],
        },
      ]);
      taskFindManyMock.mockResolvedValue([
        {
          id: TASK_ID,
          name: "PA task",
          status: TaskStatus.READY,
          assigneeId: null,
          assigneeOrchestratorId: ORCHESTRATOR_ID,
          updatedAt: new Date(),
          sokoBotWatches: [],
        },
      ]);

      const result = await new SokoBotTaskboardSyncService().syncTaskboard({
        abortSignal: new AbortController().signal,
        shouldContinue: () => true,
      });

      expect(result.woken).toBe(1);
      expect(startTurnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          source: "EVENT",
        }),
      );
      expect(startTurnMock.mock.calls[0]?.[0].message).toContain(
        '"PA task" (id',
      );
    });
  });
});
