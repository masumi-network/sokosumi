import {
  Channel,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
} from "@sokosumi/database";
import {
  buildAdHocDesignMdPrefix,
  CORE_API_ERROR_KINDS,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { publicWorkMadeBy, WORK_MAKERS } from "@/test-fixtures/work-made-by";
import { taskEventApiInclude } from "@/types/task";

import mountPatchTask, { patchTaskRequestSchema } from "./patch";

vi.mock("@/helpers/task-tag-rollout", () => ({
  TASK_WORKSPACE_JEV_ENABLED: true,
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  deliverCalendarInvalidationsNowMock,
  dueDateChangeCreateMock,
  mapTaskMock,
  markTaskAssignedReadMock,
  notifyTaskHumanAssigneeMock,
  notifyTaskStatusEventMock,
  prismaTransactionMock,
  projectFindFirstMock,
  requireTaskAssignableCoworkerMock,
  requireTaskAssignableSokoBotMock,
  requireTaskAssignableUserMock,
  publishTaskEventDataMock,
  requireTaskWriteAccessMock,
  resolveEffectiveDesignMdMock,
  taskUpdateMock,
} = vi.hoisted(() => ({
  deliverCalendarInvalidationsNowMock: vi.fn(),
  dueDateChangeCreateMock: vi.fn(),
  mapTaskMock: vi.fn(),
  markTaskAssignedReadMock: vi.fn(),
  notifyTaskHumanAssigneeMock: vi.fn(),
  notifyTaskStatusEventMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  requireTaskAssignableSokoBotMock: vi.fn(),
  requireTaskAssignableUserMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  requireTaskWriteAccessMock: vi.fn(),
  resolveEffectiveDesignMdMock: vi.fn().mockResolvedValue(null),
  taskUpdateMock: vi.fn(),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));

vi.mock("@/helpers/design-md-effective", () => ({
  resolveEffectiveDesignMd: resolveEffectiveDesignMdMock,
}));

vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: deliverCalendarInvalidationsNowMock,
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
  requireTaskAssignableUser: requireTaskAssignableUserMock,
  requireMutableTaskWriteAccess: requireTaskWriteAccessMock,
}));

vi.mock("@/helpers/soko-bot-task-assign", () => ({
  requireTaskAssignableSokoBot: requireTaskAssignableSokoBotMock,
}));

vi.mock("@/helpers/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/task")>();

  return {
    ...actual,
    mapTask: mapTaskMock,
  };
});

vi.mock("@/helpers/task-notifications", () => ({
  markTaskAssignedRead: markTaskAssignedReadMock,
  notifyTaskHumanAssignee: notifyTaskHumanAssigneeMock,
  notifyTaskStatusEvent: notifyTaskStatusEventMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: vi.fn().mockResolvedValue(true),
  lockTaskRows: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const OTHER_PROJECT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

function createTaskApi(projectId: string | null = null) {
  return {
    id: "tsk_123",
    createdAt: "2026-04-02T08:00:00.000Z",
    updatedAt: "2026-04-02T08:00:00.000Z",
    workspaceId: WORKSPACE_ID,
    ownerId: "user_123",
    organizationId: "org_123",
    projectId,
    project:
      projectId == null
        ? null
        : { id: projectId, name: "Project", identifier: null, logo: null },
    owner: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    userId: "user_123",
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
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    assignee: null,
    coworkerId: null,
    coworker: null,
    creator: {
      type: "user" as const,
      id: "user_123",
      user: {
        id: "user_123",
        name: "Ada Lovelace",
        image: null,
      },
    },
    sokoBotId: null,
    sokoBot: null,
    name: "Updated Task",
    description: null,
    status: TaskStatus.DRAFT,
    visibility: TaskVisibility.PUBLIC,
    priority: TaskPriority.NONE,
    number: null,
    identifier: null,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    credits: 0,
    events: [],
    jobs: [],
    workspace: {
      id: WORKSPACE_ID,
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    share: null,
    links: [],
    files: [],
    archivedAt: null,
    runAt: null,
    dueOn: null,
    parentTaskId: null,
    position: null,
    subtaskProgress: { completed: 0, total: 0 },
    scheduleId: null,
    followers: [],
    selectableStatuses: [],
    participants: [],
  };
}

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
    c.set("requestId", "req_patch_task_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountPatchTask(app);

  return app;
}

describe("patchTaskRequestSchema", () => {
  it("accepts projectId as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      projectId: PROJECT_ID,
    });

    expect(result.projectId).toBe(PROJECT_ID);
  });

  it("accepts context as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      context: { brand: false, briefing: false, memory: false },
    });

    expect(result.context).toEqual({
      brand: false,
      briefing: false,
      memory: false,
    });
  });

  it("accepts deprecated coworkerId as assigneeId", () => {
    const result = patchTaskRequestSchema.parse({
      coworkerId: "cow_legacy",
    });

    expect(result.assigneeId).toBe("cow_legacy");
    expect(result).not.toHaveProperty("coworkerId");
  });

  it("rejects conflicting assigneeId and coworkerId", () => {
    expect(() => {
      patchTaskRequestSchema.parse({
        assigneeId: "cow_a",
        coworkerId: "cow_b",
      });
    }).toThrow();
  });

  it("rejects assigneeId and assigneeSokoBotId together", () => {
    expect(() => {
      patchTaskRequestSchema.parse({
        assigneeId: "cow_a",
        assigneeSokoBotId: "01960001-0001-7001-8001-000000000099",
      });
    }).toThrow();
  });

  it("accepts assigneeUserId as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      assigneeUserId: "user_123",
    });

    expect(result.assigneeUserId).toBe("user_123");
  });

  it("strips the retired expectedScheduleRevision field", () => {
    const result = patchTaskRequestSchema.parse({
      name: "Renamed task",
      expectedScheduleRevision: 3,
    });

    expect(result).toEqual({ name: "Renamed task" });
  });

  it("rejects the retired expectedScheduleRevision as the only patch field", () => {
    expect(() => {
      patchTaskRequestSchema.parse({ expectedScheduleRevision: 3 });
    }).toThrow();
  });

  it("accepts runAt as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      runAt: "2099-01-05T09:00:00.000Z",
    });

    expect(result.runAt).toBe("2099-01-05T09:00:00.000Z");
  });

  it("accepts clearing runAt as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({ runAt: null });

    expect(result.runAt).toBeNull();
  });

  it("accepts priority as the only patch field", () => {
    const result = patchTaskRequestSchema.parse({
      priority: TaskPriority.HIGH,
    });

    expect(result.priority).toBe(TaskPriority.HIGH);
  });

  it("rejects an unknown priority", () => {
    expect(() => {
      patchTaskRequestSchema.parse({ priority: "HUGE" });
    }).toThrow();
  });

  it("accepts dueOn as the only patch field", () => {
    expect(patchTaskRequestSchema.parse({ dueOn: "2026-11-20" }).dueOn).toBe(
      "2026-11-20",
    );
    expect(patchTaskRequestSchema.parse({ dueOn: null }).dueOn).toBeNull();
  });

  it("rejects a dueOn with a time", () => {
    expect(() => {
      patchTaskRequestSchema.parse({ dueOn: "2026-11-20T09:00:00.000Z" });
    }).toThrow();
  });

  it("rejects coworker and user assignees together", () => {
    expect(() => {
      patchTaskRequestSchema.parse({
        assigneeId: "cow_a",
        assigneeUserId: "user_a",
      });
    }).toThrow();
  });
});

describe("PATCH /tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: null,
      visibility: TaskVisibility.PUBLIC,
    });
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    resolveEffectiveDesignMdMock.mockResolvedValue(null);
    taskUpdateMock.mockResolvedValue(createTaskApi(PROJECT_ID));
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        projectSeoAnalysis: { findUnique: async () => null },
        project: {
          findFirst: projectFindFirstMock,
        },
        task: {
          update: taskUpdateMock,
          // No sub-tasks follow the Task to another Project.
          findMany: async () => [],
        },
        taskDueDateChange: { create: dueDateChangeCreateMock },
      });
    });
  });

  it("keeps the path UUID-only: an identifier is looked up as a raw id", async () => {
    const app = createApp();
    requireTaskWriteAccessMock.mockImplementation(() => {
      throw notFound("Task not found");
    });

    const response = await app.request("http://localhost/SOK-12", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Renamed",
      }),
    });

    expect(response.status).toBe(404);
    expect(requireTaskWriteAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "SOK-12",
      expect.anything(),
    );
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("assigns a task to a workspace project", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(deliverCalendarInvalidationsNowMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
      select: { id: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  it("unassigns a task from its project", async () => {
    const app = createApp();
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue(createTaskApi(null));

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: null,
        }),
      }),
    );
  });

  it("rejects assignment to a project outside the task workspace", async () => {
    const app = createApp();
    projectFindFirstMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an update when the task moves workspaces before its row is locked", async () => {
    const app = createApp();
    requireTaskWriteAccessMock
      .mockResolvedValueOnce({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
      })
      .mockResolvedValueOnce({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        projectId: null,
        workspaceId: "33333333-3333-4333-8333-333333333333",
      });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(409);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("moves a task directly between projects", async () => {
    const app = createApp();
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      projectId: OTHER_PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: PROJECT_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  it("refuses a project change when a sub-task that would follow is parked", async () => {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      projectId: OTHER_PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        projectSeoAnalysis: {
          findUnique: async () => null,
          findFirst: async () => null,
        },
        project: { findFirst: projectFindFirstMock },
        task: {
          update: taskUpdateMock,
          // One level of sub-tasks below the Task, then none.
          findMany: async ({
            where,
          }: {
            where: { parentTaskId?: { in: string[] } };
          }) =>
            where.parentTaskId
              ? where.parentTaskId.in.includes("tsk_123")
                ? [{ id: "tsk_child" }]
                : []
              : [{ status: TaskStatus.GRANT_PENDING }],
        },
      }),
    );
    const app = createApp();
    app.onError(errorHandler);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ kind: "task_parked" });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("retries a Project change that Postgres broke off to end a deadlock", async () => {
    prismaTransactionMock.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "Invalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `40P01`. Message: `deadlock detected`",
        ),
        { name: "PrismaClientKnownRequestError", code: "P2010" },
      ),
    );

    const response = await createApp().request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).toHaveBeenCalledTimes(2);
  });

  it("updates priority alone", async () => {
    const response = await createApp().request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: TaskPriority.URGENT }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock.mock.lastCall?.[0].data).toStrictEqual({
      priority: TaskPriority.URGENT,
    });
  });

  it("stores dueOn as the calendar day it names", async () => {
    const response = await createApp().request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueOn: "2026-11-20" }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dueOn: new Date("2026-11-20T00:00:00.000Z"),
        }),
      }),
    );
  });

  it("records a due date moved later, and nothing for an earlier one", async () => {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.RUNNING,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: null,
      visibility: TaskVisibility.PUBLIC,
      dueOn: new Date("2026-11-10T00:00:00.000Z"),
    });
    const patchDueOn = (dueOn: string) =>
      createApp().request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueOn }),
      });

    expect((await patchDueOn("2026-11-05")).status).toBe(200);
    expect(dueDateChangeCreateMock).not.toHaveBeenCalled();

    expect((await patchDueOn("2026-11-20")).status).toBe(200);
    expect(dueDateChangeCreateMock).toHaveBeenCalledWith({
      data: {
        taskId: "tsk_123",
        fromDueOn: new Date("2026-11-10T00:00:00.000Z"),
        toDueOn: new Date("2026-11-20T00:00:00.000Z"),
        actorUserId: "user_123",
      },
    });
  });

  it("clears dueOn on a running Task, outside the editable statuses", async () => {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.RUNNING,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: null,
      visibility: TaskVisibility.PUBLIC,
    });

    const response = await createApp().request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueOn: null }),
    });

    expect(response.status).toBe(200);
    const [{ where, data }] = taskUpdateMock.mock.calls[0];
    expect(where).toEqual({ id: "tsk_123", archivedAt: null });
    expect(data.dueOn).toBeNull();
  });

  it("keeps other fields locked on a running Task even beside dueOn", async () => {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.RUNNING,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: null,
      visibility: TaskVisibility.PUBLIC,
    });

    const response = await createApp().request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueOn: "2026-11-20", name: "Renamed" }),
    });

    expect(response.status).toBe(403);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid priority", async () => {
    const response = await createApp().request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "HUGE" }),
    });

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("updates fields of a queued task", async () => {
    const app = createApp();
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.QUEUED,
      assigneeId: "cow_123",
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      status: TaskStatus.QUEUED,
      name: "Updated queued task",
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated queued task",
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY],
          },
        }),
        data: expect.objectContaining({
          name: "Updated queued task",
        }),
      }),
    );
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Hijacked",
      }),
    });

    expect(response.status).toBe(403);
    expect(requireTaskWriteAccessMock).not.toHaveBeenCalled();
  });

  it("assigns a personal assistant as soko bot", async () => {
    const sokoBotId = "01960001-0001-7001-8001-000000000099";
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    requireTaskAssignableSokoBotMock.mockResolvedValue(undefined);

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assigneeSokoBotId: sokoBotId,
      }),
    });

    expect(response.status).toBe(200);
    expect(requireTaskAssignableSokoBotMock).toHaveBeenCalledWith(
      sokoBotId,
      WORKSPACE_ID,
      expect.anything(),
      { kind: "user", userId: "user_123" },
      expect.objectContaining({ projectId: null }),
    );
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeId: null,
          assigneeSokoBotId: sokoBotId,
        }),
      }),
    );
  });

  describe("assigning an agent to a silently reopened Task (SOKD-279)", () => {
    const taskEventFindFirstMock = vi.fn();
    const taskEventCountMock = vi.fn();
    const taskEventCreateMock = vi.fn();

    beforeEach(() => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.READY,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
        ownerId: "user_123",
        visibility: TaskVisibility.PUBLIC,
      });
      requireTaskAssignableCoworkerMock.mockResolvedValue(undefined);
      taskUpdateMock.mockResolvedValue({
        ...createTaskApi(),
        assignee: { name: "Writer" },
      });
      taskEventFindFirstMock.mockResolvedValue({
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
      });
      taskEventCreateMock.mockResolvedValue({ id: "event_parked" });
      notifyTaskStatusEventMock.mockResolvedValue(undefined);
      prismaTransactionMock.mockImplementation(async (callback) =>
        callback({
          projectSeoAnalysis: { findUnique: async () => null },
          task: { update: taskUpdateMock },
          taskEvent: {
            findFirst: taskEventFindFirstMock,
            count: taskEventCountMock,
            create: taskEventCreateMock,
          },
        }),
      );
    });

    function assignCoworker() {
      return createApp().request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: "cow_123" }),
      });
    }

    it("parks it in Input required with a Core comment and tells the Owner", async () => {
      taskEventCountMock.mockResolvedValue(0);

      expect((await assignCoworker()).status).toBe(200);
      expect(taskUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: "cow_123",
            status: TaskStatus.INPUT_REQUIRED,
          }),
        }),
      );
      const event = taskEventCreateMock.mock.calls[0]?.[0].data;
      expect(event).toMatchObject({
        status: TaskStatus.INPUT_REQUIRED,
        comment: "Reopened without instructions. Tell Writer what to do.",
      });
      expect(event.userId).toBeUndefined();
      expect(notifyTaskStatusEventMock).toHaveBeenCalledWith(
        "tsk_123",
        "event_parked",
        TaskStatus.INPUT_REQUIRED,
        null,
      );
    });

    it("parks a queued one too and drops its Run at", async () => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.QUEUED,
        runAt: new Date(Date.now() + 86_400_000),
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
        ownerId: "user_123",
        visibility: TaskVisibility.PUBLIC,
      });
      taskEventCountMock.mockResolvedValue(0);

      expect((await assignCoworker()).status).toBe(200);
      expect(taskUpdateMock.mock.calls[0]?.[0].data).toMatchObject({
        status: TaskStatus.INPUT_REQUIRED,
        runAt: null,
      });
    });

    it("parks its own Coworker's Draft that a Run at queues again", async () => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: "cow_123",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
        ownerId: "user_123",
        visibility: TaskVisibility.PUBLIC,
      });
      taskEventCountMock.mockResolvedValue(0);

      const response = await createApp().request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });

      expect(response.status).toBe(200);
      expect(taskUpdateMock.mock.calls[0]?.[0].data).toMatchObject({
        status: TaskStatus.INPUT_REQUIRED,
        runAt: null,
      });
    });

    function assignWithDescription(
      description: string,
      stored = "Use the February figures",
    ) {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.READY,
        description: stored,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
        ownerId: "user_123",
        visibility: TaskVisibility.PUBLIC,
      });
      taskEventCountMock.mockResolvedValue(0);
      return createApp().request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: "cow_123", description }),
      });
    }

    it("parks it when the edit form resends the stored description", async () => {
      expect(
        (await assignWithDescription("Use the February figures")).status,
      ).toBe(200);
      expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBe(
        TaskStatus.INPUT_REQUIRED,
      );
    });

    it("parks it when the stored description also holds Context links", async () => {
      const stored =
        "[BRIEFING.md](https://example.test/briefing.md)\n\nUse the February figures";
      expect(
        (await assignWithDescription("Use the February figures", stored))
          .status,
      ).toBe(200);
      expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBe(
        TaskStatus.INPUT_REQUIRED,
      );
    });

    it("keeps it Ready when the same save changes the description", async () => {
      expect(
        (await assignWithDescription("Use the March figures")).status,
      ).toBe(200);
      expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBeUndefined();
    });

    it("keeps it Ready when a person commented after the reopen", async () => {
      taskEventCountMock.mockResolvedValue(1);

      expect((await assignCoworker()).status).toBe(200);
      expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBeUndefined();
      expect(taskEventCreateMock).not.toHaveBeenCalled();
      expect(notifyTaskStatusEventMock).not.toHaveBeenCalled();
    });
  });

  it("rejects assigning someone else's personal assistant with 403", async () => {
    const sokoBotId = "01960001-0001-7001-8001-000000000099";
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
    });
    requireTaskAssignableSokoBotMock.mockRejectedValue(
      forbidden("Only the owner can assign work to this Soko Bot"),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assigneeSokoBotId: sokoBotId,
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(
      "Only the owner can assign work to this Soko Bot",
    );
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  describe("PATCH /tasks/{id} human assignee (SOK-868)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
      });
      taskUpdateMock.mockResolvedValue(createTaskApi(null));
      mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
      prismaTransactionMock.mockImplementation(async (callback) => {
        return await callback({
          projectSeoAnalysis: { findUnique: async () => null },
          project: { findFirst: projectFindFirstMock },
          task: { update: taskUpdateMock },
        });
      });
    });

    it("notifies when a workspace member becomes the assignee", async () => {
      const participants = [
        {
          user: { id: "user_bob", name: "Bob", image: null },
          addedAt: "2026-04-02T08:00:00.000Z",
        },
      ];
      taskUpdateMock.mockResolvedValue({
        ...createTaskApi(null),
        assigneeUserId: "user_assignee",
        participants,
      });
      mapTaskMock.mockImplementation((task) => ({
        ...createTaskApi(task.projectId),
        assigneeUserId: task.assigneeUserId,
        participants: task.participants,
      }));

      const app = createApp();
      const response = await app.request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: "user_assignee" }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.participants).toEqual(participants);
      expect(taskUpdateMock.mock.calls[0]?.[0].data).not.toHaveProperty(
        "participants",
      );
      expect(requireTaskAssignableUserMock).toHaveBeenCalledWith(
        "user_assignee",
        WORKSPACE_ID,
        expect.anything(),
      );
      expect(notifyTaskHumanAssigneeMock).toHaveBeenCalledWith(
        "tsk_123",
        "user_assignee",
      );
    });

    it("rejects two assignees", async () => {
      const app = createApp();
      const response = await app.request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeId: "cow_123",
          assigneeUserId: "user_assignee",
        }),
      });

      expect(response.status).toBe(422);
      expect(taskUpdateMock).not.toHaveBeenCalled();
    });

    it("rejects assigning a human teammate to a private Task", async () => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
        visibility: TaskVisibility.PRIVATE,
      });

      const app = createApp();
      const response = await app.request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: "user_assignee" }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Private Tasks cannot be assigned to a human teammate",
      );
      expect(taskUpdateMock).not.toHaveBeenCalled();
    });

    it("does not notify when the human assignee is cleared", async () => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: "user_assignee",
        projectId: null,
        workspaceId: WORKSPACE_ID,
      });

      const app = createApp();
      const response = await app.request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: null }),
      });

      expect(response.status).toBe(200);
      expect(notifyTaskHumanAssigneeMock).not.toHaveBeenCalled();
    });

    /**
     * The `assigned` row says the task is yours, and clearing the assignee
     * makes that false. Nobody else clears it, so without this the previous
     * holder keeps an unread row and the follow-up sync reminds them about a
     * task they no longer have (SOK-916).
     */
    it("marks the previous holder's assigned row read", async () => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: "user_assignee",
        projectId: null,
        workspaceId: WORKSPACE_ID,
      });

      const app = createApp();
      const response = await app.request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: null }),
      });

      expect(response.status).toBe(200);
      expect(markTaskAssignedReadMock).toHaveBeenCalledWith(
        "user_assignee",
        "tsk_123",
      );
    });

    it("does not notify when the task is assigned to a coworker", async () => {
      const app = createApp();
      const response = await app.request("http://localhost/tsk_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: "cow_123", assigneeUserId: null }),
      });

      expect(response.status).toBe(200);
      expect(notifyTaskHumanAssigneeMock).not.toHaveBeenCalled();
    });
  });

  it("re-applies Context attachments on description when context is provided", async () => {
    const app = createApp();
    const designMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md";
    const briefingUrl = "https://store.public.blob.vercel-storage.com/brief.md";
    const contextMdUrl =
      "https://store.public.blob.vercel-storage.com/context.md";
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: `[DESIGN.md](${designMdUrl})\n\nOld prose`,
      visibility: TaskVisibility.PUBLIC,
    });
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      filesToken: null,
      designMdUrl,
      briefing: null,
      briefingUrl,
      contextMdUrl,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Updated prose",
        context: { brand: true, brandSource: "project" },
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${designMdUrl})\n[BRIEFING.md](${briefingUrl})\n[CONTEXT.md](${contextMdUrl})\n\nUpdated prose`,
        }),
      }),
    );
  });

  it("opts out of Context attachments when context flags are false", async () => {
    const app = createApp();
    const designMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md";
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: `[DESIGN.md](${designMdUrl})\n\nKeep prose`,
      visibility: TaskVisibility.PUBLIC,
    });
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      filesToken: null,
      designMdUrl,
      briefing: null,
      briefingUrl: "https://store.public.blob.vercel-storage.com/brief.md",
      contextMdUrl: "https://store.public.blob.vercel-storage.com/context.md",
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Keep prose",
        context: { brand: false, briefing: false, memory: false },
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: "Keep prose",
        }),
      }),
    );
  });

  it("grandfathers a stored DESIGN.md URL that is no longer live project brand", async () => {
    const app = createApp();
    const staleBrandUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/old.md";
    const liveBrandUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/new.md";
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: `[DESIGN.md](${staleBrandUrl})\n\nKeep prose`,
      visibility: TaskVisibility.PUBLIC,
    });
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      filesToken: null,
      designMdUrl: liveBrandUrl,
      briefing: null,
      briefingUrl: null,
      contextMdUrl: null,
    });
    resolveEffectiveDesignMdMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Keep prose",
        context: { brand: { url: staleBrandUrl } },
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${staleBrandUrl})\n\nKeep prose`,
        }),
      }),
    );
  });

  it("accepts the acting member's own ad-hoc brand on another member's task", async () => {
    const app = createApp();
    const memberBrandUrl = `https://store.public.blob.vercel-storage.com/${buildAdHocDesignMdPrefix("user_123")}brand.md`;
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_owner",
      description: "Keep prose",
      visibility: TaskVisibility.PUBLIC,
    });
    resolveEffectiveDesignMdMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Keep prose",
        context: { brand: { url: memberBrandUrl } },
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${memberBrandUrl})\n\nKeep prose`,
        }),
      }),
    );
  });

  it("treats explicit description null as empty prose when context is provided", async () => {
    const app = createApp();
    const designMdUrl =
      "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md";
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: `[DESIGN.md](${designMdUrl})\n\nOld prose that must clear`,
      visibility: TaskVisibility.PUBLIC,
    });
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      filesToken: null,
      designMdUrl,
      briefing: null,
      briefingUrl: null,
      contextMdUrl: null,
    });

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: null,
        context: { brand: true, brandSource: "project" },
      }),
    });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: `[DESIGN.md](${designMdUrl})`,
        }),
      }),
    );
  });

  it("rejects when Context resolves to no attachments and prose is empty", async () => {
    const app = createApp();
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: "Existing prose",
      visibility: TaskVisibility.PUBLIC,
    });
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      filesToken: null,
      designMdUrl: null,
      briefing: null,
      briefingUrl: null,
      contextMdUrl: null,
    });
    resolveEffectiveDesignMdMock.mockResolvedValue(null);

    const response = await app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "",
        context: { brand: true, brandSource: "project" },
      }),
    });

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /tasks/{id} Queued Task with a Run at (ADR 0041)", () => {
  const taskEventCreateMock = vi.fn();

  function mockQueuedTask(overrides: Record<string, unknown> = {}) {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.QUEUED,
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: null,
      visibility: TaskVisibility.PUBLIC,
      runAt: new Date("2099-01-05T09:00:00.000Z"),
      scheduleId: null,
      ...overrides,
    });
  }

  function patch(body: Record<string, unknown>) {
    const app = createApp();
    app.onError(errorHandler);
    return app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function writtenData() {
    return taskUpdateMock.mock.calls[0]?.[0].data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      status: TaskStatus.QUEUED,
    });
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        projectSeoAnalysis: { findUnique: async () => null },
        project: { findFirst: projectFindFirstMock },
        // No sub-tasks follow the Task to another Project.
        task: { update: taskUpdateMock, findMany: async () => [] },
        taskEvent: { create: taskEventCreateMock },
      });
    });
    mockQueuedTask();
  });

  it("edits a field without a revision and keeps the Task Queued", async () => {
    const response = await patch({ name: "Renamed task" });

    expect(response.status).toBe(200);
    expect(writtenData()).toEqual({ name: "Renamed task" });
    expect(taskEventCreateMock).not.toHaveBeenCalled();
  });

  it("moves it into a project", async () => {
    const response = await patch({ projectId: PROJECT_ID });

    expect(response.status).toBe(200);
    expect(writtenData()).toEqual({ projectId: PROJECT_ID });
    expect(taskEventCreateMock).not.toHaveBeenCalled();
  });

  it("moves it out of its project", async () => {
    mockQueuedTask({ projectId: PROJECT_ID });

    const response = await patch({ projectId: null });

    expect(response.status).toBe(200);
    expect(writtenData()).toEqual({ projectId: null });
    expect(projectFindFirstMock).not.toHaveBeenCalled();
  });

  it("edits a Task created by a Task Schedule like any other Task", async () => {
    mockQueuedTask({ scheduleId: "sch_123" });

    const response = await patch({
      name: "Renamed run",
      projectId: PROJECT_ID,
    });

    expect(response.status).toBe(200);
    expect(writtenData()).toEqual({
      name: "Renamed run",
      projectId: PROJECT_ID,
    });
  });
});

describe("PATCH /tasks/{id} Run at and workspace tags", () => {
  const clearTags = vi.fn();
  const removedAssignments = vi.fn();
  const allowedLabels = vi.fn();
  const saveDecisions = vi.fn();
  const clearDecisions = vi.fn();
  const saveAssignments = vi.fn();
  const RUN_AT = "2099-01-05T09:00:00.000Z";
  const LATER_RUN_AT = "2099-01-12T09:00:00.000Z";
  const taskEventCreateMock = vi.fn();

  function createdStatusEvent(status: TaskStatus) {
    return {
      id: "evt_run_at",
      taskId: "tsk_123",
      createdAt: new Date("2026-04-02T08:00:00.000Z"),
      updatedAt: new Date("2026-04-02T08:00:00.000Z"),
      status,
      comment: null,
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      userId: "user_123",
      coworkerId: null,
      sokoBotId: null,
      transactionId: null,
      cents: null,
      user: { id: "user_123", name: "Ada Lovelace", image: null },
      coworker: null,
      sokoBot: null,
      transaction: null,
    };
  }

  function mockTask(overrides: Record<string, unknown> = {}) {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_123",
      ownerId: "user_123",
      description: null,
      visibility: TaskVisibility.PUBLIC,
      runAt: null,
      ...overrides,
    });
  }

  function patch(body: Record<string, unknown>) {
    const app = createApp();
    app.onError(errorHandler);
    return app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    removedAssignments.mockResolvedValue([]);
    taskUpdateMock.mockResolvedValue(createTaskApi(null));
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        projectSeoAnalysis: { findUnique: async () => null },
        project: { findFirst: projectFindFirstMock },
        task: { update: taskUpdateMock },
        // Never finished, so never reopened.
        taskEvent: {
          create: taskEventCreateMock,
          findFirst: async () => null,
        },
        $queryRaw: allowedLabels,
        taskWorkspaceTagDecision: {
          createMany: saveDecisions,
          deleteMany: clearDecisions,
        },
        taskWorkspaceTag: {
          findMany: removedAssignments,
          createMany: saveAssignments,
          deleteMany: clearTags,
        },
      });
    });
    mockTask();
  });

  it("dismisses automatic and legacy manual topics on a completed Task", async () => {
    mockTask({
      status: TaskStatus.COMPLETED,
      automaticTags: ["research", "social"],
      manualTags: ["design", "writing", "legacy-future"],
      rejectedTags: ["monitoring", "legacy-future"],
    });
    const response = await patch({
      dismissedTopicIds: ["research", "design", "design", "monitoring"],
    });
    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          manualTags: ["writing", "legacy-future"],
          rejectedTags: ["monitoring", "legacy-future", "research", "design"],
        }),
      }),
    );
    expect(clearTags).not.toHaveBeenCalled();
    expect(taskEventCreateMock).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown topic dismissals with other valid changes", async () => {
    const response = await patch({
      name: "New title",
      dismissedTopicIds: ["whatever"],
    });
    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("clears workspace tags on a completed Task without a status change", async () => {
    mockTask({ status: TaskStatus.COMPLETED });
    const response = await patch({ workspaceTagIds: [] });
    expect(response.status).toBe(200);
    expect(clearTags).toHaveBeenCalledWith({
      where: { taskId: "tsk_123", labelId: { notIn: [] } },
    });
    expect(taskEventCreateMock).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: "user_123",
      taskId: "tsk_123",
      eventType: "task_event",
    });
  });

  it("accepts one suggestion, remembers removed tags and explicitly dismisses others", async () => {
    const [retained, accepted, removed, dismissed] = [
      "00000000-1111-4111-8111-111111111111",
      "00000000-2222-4222-8222-222222222222",
      "00000000-3333-4333-8333-333333333333",
      "00000000-4444-4444-8444-444444444444",
    ] as const;
    mockTask({ status: TaskStatus.COMPLETED });
    allowedLabels.mockResolvedValueOnce(
      [retained, accepted, dismissed].map((id) => ({ id })),
    );
    removedAssignments.mockResolvedValueOnce([{ labelId: removed }]);
    const response = await patch({
      workspaceTagIds: [retained, accepted],
      dismissedWorkspaceTagIds: [dismissed, accepted],
    });
    expect(response.status).toBe(200);
    expect(clearDecisions).toHaveBeenCalledExactlyOnceWith({
      where: {
        taskId: "tsk_123",
        labelId: { in: [retained, accepted, dismissed, removed] },
      },
    });
    expect(saveDecisions).toHaveBeenCalledExactlyOnceWith({
      data: [dismissed, removed].map((labelId) => ({
        taskId: "tsk_123",
        labelId,
        state: "JEV_DISMISSED",
      })),
    });
    expect(saveAssignments).toHaveBeenCalledExactlyOnceWith({
      data: [retained, accepted].map((labelId) => ({
        taskId: "tsk_123",
        labelId,
      })),
      skipDuplicates: true,
    });
    expect(taskEventCreateMock).not.toHaveBeenCalled();
  });

  it("refuses to change labels on a Task outside the active workspace", async () => {
    mockTask({ workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" });
    const response = await patch({ workspaceTagIds: [] });
    expect(response.status).toBe(404);
    expect(clearTags).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("queues a Draft Task at its Run at", async () => {
    const queuedEvent = createdStatusEvent(TaskStatus.QUEUED);
    taskEventCreateMock.mockResolvedValue(queuedEvent);

    const response = await patch({ runAt: RUN_AT });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.QUEUED,
          runAt: new Date(RUN_AT),
        }),
      }),
    );
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: {
        taskId: "tsk_123",
        status: TaskStatus.QUEUED,
        channel: Channel.SOKOSUMI,
        userId: "user_123",
        coworkerId: null,
        sokoBotId: null,
      },
      include: taskEventApiInclude,
    });
    expect(mapTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            id: queuedEvent.id,
            status: TaskStatus.QUEUED,
            user: queuedEvent.user,
          }),
        ]),
      }),
      expect.anything(),
    );
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: "user_123",
      taskId: "tsk_123",
      eventType: "task_event",
    });
  });

  it.each([
    ["its Owner", "user_owner"],
    ["nobody when it has no Owner", null],
  ])("sends the live update for a queued Task to %s", async (_who, ownerId) => {
    taskEventCreateMock.mockResolvedValue(
      createdStatusEvent(TaskStatus.QUEUED),
    );
    taskUpdateMock.mockResolvedValue({
      ...createTaskApi(null),
      ownerId,
      creatorUserId: null,
    });

    const response = await patch({ runAt: RUN_AT });

    expect(response.status).toBe(200);
    expect(
      publishTaskEventDataMock.mock.calls.map(([input]) => input.userId),
    ).toEqual(ownerId ? [ownerId] : []);
  });

  it("moves the Run at of a Queued Task without a status event", async () => {
    mockTask({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });

    const response = await patch({ runAt: LATER_RUN_AT });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ runAt: new Date(LATER_RUN_AT) }),
      }),
    );
    expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBeUndefined();
    expect(taskEventCreateMock).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
  });

  it("moves a Queued Task back to Draft when its Run at is cleared", async () => {
    mockTask({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });
    const draftEvent = createdStatusEvent(TaskStatus.DRAFT);
    taskEventCreateMock.mockResolvedValue(draftEvent);

    const response = await patch({ runAt: null });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.DRAFT,
          runAt: null,
        }),
      }),
    );
    expect(taskEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TaskStatus.DRAFT }),
        include: taskEventApiInclude,
      }),
    );
    expect(mapTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            id: draftEvent.id,
            status: TaskStatus.DRAFT,
            user: draftEvent.user,
          }),
        ]),
      }),
      expect.anything(),
    );
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: "user_123",
      taskId: "tsk_123",
      eventType: "task_event",
    });
  });

  it("treats clearing an unset Run at as a no-op", async () => {
    const response = await patch({ runAt: null });

    expect(response.status).toBe(200);
    expect(taskUpdateMock.mock.calls[0]?.[0].data.status).toBeUndefined();
    expect(taskEventCreateMock).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
  });

  it("rejects a Run at that has passed", async () => {
    const response = await patch({ runAt: "2020-01-01T09:00:00.000Z" });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.RUN_AT_NOT_IN_FUTURE,
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a Run at on a Task without an agent assignee", async () => {
    mockTask({ assigneeId: null, assigneeUserId: "user_456" });

    const response = await patch({ runAt: RUN_AT });

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects unassigning the agent of a Queued Task", async () => {
    mockTask({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });

    const response = await patch({ assigneeId: null });

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects assigning a queued Task to a human", async () => {
    mockTask({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });

    const response = await patch({ assigneeUserId: "user_456" });

    expect(response.status).toBe(422);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("allows a human when the same patch clears Run at", async () => {
    mockTask({ status: TaskStatus.QUEUED, runAt: new Date(RUN_AT) });

    const response = await patch({ runAt: null, assigneeUserId: "user_456" });

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.DRAFT,
          runAt: null,
          assigneeId: null,
          assigneeUserId: "user_456",
        }),
      }),
    );
  });
});

describe("PATCH /tasks/{id} Seat check of the Owner (ADR 0057)", () => {
  function patch(body: Record<string, unknown>) {
    const app = createApp();
    app.onError(errorHandler);
    return app.request("http://localhost/tsk_123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    taskUpdateMock.mockResolvedValue(createTaskApi(null));
    mapTaskMock.mockImplementation((task) => createTaskApi(task.projectId));
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        projectSeoAnalysis: { findUnique: async () => null },
        project: { findFirst: projectFindFirstMock },
        task: { update: taskUpdateMock },
      });
    });
  });

  it.each(WORK_MAKERS)(
    "seats the Owner of public work made by a %s on the billing organization",
    async (maker) => {
      requireTaskWriteAccessMock.mockResolvedValue({
        id: "tsk_123",
        status: TaskStatus.DRAFT,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
        projectId: null,
        workspaceId: WORKSPACE_ID,
        organizationId: "org_billing",
        description: null,
        visibility: TaskVisibility.PUBLIC,
        runAt: null,
        ...publicWorkMadeBy(maker, "user_123"),
      });

      const response = await patch({ name: "Renamed" });

      expect(response.status).toBe(200);
      expect(requireAssignedOrganizationSeat).toHaveBeenCalledWith(
        "user_123",
        "org_billing",
        expect.anything(),
      );
    },
  );

  it("leaves a member who is not the Owner to the write-access Seat check", async () => {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_billing",
      description: null,
      visibility: TaskVisibility.PUBLIC,
      runAt: null,
      ...publicWorkMadeBy("person", "user_other"),
    });

    const response = await patch({ name: "Renamed" });

    expect(response.status).toBe(200);
    expect(requireAssignedOrganizationSeat).not.toHaveBeenCalled();
  });

  it("checks no Owner Seat on a Task without an Owner", async () => {
    requireTaskWriteAccessMock.mockResolvedValue({
      id: "tsk_123",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      projectId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_billing",
      description: null,
      visibility: TaskVisibility.PUBLIC,
      runAt: null,
      ...publicWorkMadeBy("sokoBot", null),
    });

    const response = await patch({ name: "Renamed" });

    expect(response.status).toBe(200);
    expect(requireAssignedOrganizationSeat).not.toHaveBeenCalled();
  });
});
