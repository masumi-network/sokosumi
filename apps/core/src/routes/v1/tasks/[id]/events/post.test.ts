import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountPostTaskEvents from "./post";

const {
  createTaskEventTransactionMock,
  prismaTransactionMock,
  publishTaskEventDataMock,
  requireCoworkerTaskAccessMock,
  requireTaskCollaboratorAccessMock,
  requireUserTaskAccessMock,
} = vi.hoisted(() => ({
  createTaskEventTransactionMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  requireCoworkerTaskAccessMock: vi.fn(),
  requireTaskCollaboratorAccessMock: vi.fn(),
  requireUserTaskAccessMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerTaskAccess: requireCoworkerTaskAccessMock,
  requireTaskCollaboratorAccess: requireTaskCollaboratorAccessMock,
  requireUserTaskAccess: requireUserTaskAccessMock,
}));

vi.mock("@/helpers/task-credits", () => ({
  createTaskEventTransaction: createTaskEventTransactionMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const TASK_ID = "tsk_123";
const USER_ID = "user_123";
const COWORKER_ID = "cow_123";
const TASK_EVENT_USER_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
};

interface TaskEventRecord {
  id: string;
  taskId: string;
  createdAt: Date;
  updatedAt: Date;
  status: TaskStatus | null;
  comment: string | null;
  authenticationUrl: string | null;
  origin: TaskEventOrigin;
  userId: string | null;
  coworkerId: string | null;
  transactionId: string | null;
  cents: bigint | null;
  user?: {
    id: string;
    name: string;
    image: string | null;
  } | null;
}

interface TransactionMock {
  taskEvent: {
    create: ReturnType<typeof vi.fn>;
  };
  task: {
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function createTask(
  overrides: Partial<{
    organizationId: string | null;
    coworkerId: string | null;
    status: TaskStatus;
    userId: string;
  }> = {},
) {
  return {
    id: TASK_ID,
    status: TaskStatus.RUNNING,
    coworkerId: COWORKER_ID,
    userId: USER_ID,
    organizationId: null,
    ...overrides,
  };
}

function createTaskEvent(
  overrides: Partial<TaskEventRecord> = {},
): TaskEventRecord {
  return {
    id: "evt_123",
    taskId: TASK_ID,
    createdAt: new Date("2026-02-20T12:00:00.000Z"),
    updatedAt: new Date("2026-02-20T12:00:00.000Z"),
    status: TaskStatus.OUT_OF_CREDITS,
    comment: null,
    authenticationUrl: null,
    origin: TaskEventOrigin.SOKOSUMI,
    userId: null,
    coworkerId: COWORKER_ID,
    transactionId: null,
    cents: null,
    ...overrides,
  };
}

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set(
      "workspaceContext",
      authContext.actor === "user"
        ? {
            workspaceId: "11111111-1111-7111-8111-111111111111",
            userId: authContext.userId,
            organizationId: authContext.organizationId,
          }
        : null,
    );
    return await next();
  });

  mountPostTaskEvents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(
    async (callback: (tx: TransactionMock) => unknown) => {
      return await callback(tx);
    },
  );
}

describe("POST /{id}/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishTaskEventDataMock.mockResolvedValue(undefined);
  });

  it("allows coworkers to create OUT_OF_CREDITS events", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi
          .fn()
          .mockResolvedValue(
            createTaskEvent({ status: TaskStatus.OUT_OF_CREDITS }),
          ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    requireCoworkerTaskAccessMock.mockResolvedValue(createTask());

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.OUT_OF_CREDITS,
        comment: "Need top-up",
      }),
    });

    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.status).toBe(TaskStatus.OUT_OF_CREDITS);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          coworkerId: COWORKER_ID,
          userId: null,
        }),
        include: TASK_EVENT_USER_INCLUDE,
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.OUT_OF_CREDITS },
      }),
    );
  });

  it("allows org members to comment on workspace tasks they do not own", async () => {
    const taskEventUser = {
      id: "user_789",
      name: "Grace Hopper",
      image: "https://example.com/grace.png",
    };
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            comment: "Handled by teammate",
            userId: "user_789",
            coworkerId: null,
            user: taskEventUser,
          }),
        ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    requireTaskCollaboratorAccessMock.mockResolvedValue(
      createTask({
        userId: "user_456",
        organizationId: "org_123",
        coworkerId: null,
      }),
    );

    const app = createApp({
      actor: "user",
      userId: "user_789",
      organizationId: "org_123",
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: "Handled by teammate",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.user).toEqual(taskEventUser);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: TASK_ID,
          comment: "Handled by teammate",
          userId: "user_789",
          coworkerId: null,
        }),
        include: TASK_EVENT_USER_INCLUDE,
      }),
    );
    expect(tx.task.updateMany).not.toHaveBeenCalled();
    expect(requireTaskCollaboratorAccessMock).toHaveBeenCalledWith(
      {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: "user_789",
        organizationId: "org_123",
      },
      TASK_ID,
      expect.any(Object),
    );
    expect(requireUserTaskAccessMock).not.toHaveBeenCalled();
  });

  it("returns the author summary for user status changes", async () => {
    const taskEventUser = {
      id: USER_ID,
      name: "Ada Lovelace",
      image: "https://example.com/ada.png",
    };
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.CANCELED,
            comment: "Stopping this run",
            userId: USER_ID,
            coworkerId: null,
            user: taskEventUser,
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    requireUserTaskAccessMock.mockResolvedValue(
      createTask({
        status: TaskStatus.READY,
        userId: USER_ID,
        coworkerId: null,
      }),
    );

    const app = createApp({
      actor: "user",
      userId: USER_ID,
      organizationId: null,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.CANCELED,
        comment: "Stopping this run",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.user).toEqual(taskEventUser);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: TASK_ID,
          status: TaskStatus.CANCELED,
          userId: USER_ID,
          coworkerId: null,
        }),
        include: TASK_EVENT_USER_INCLUDE,
      }),
    );
    expect(requireUserTaskAccessMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: USER_ID,
        organizationId: null,
      },
      TASK_ID,
      expect.any(Object),
    );
    expect(requireTaskCollaboratorAccessMock).not.toHaveBeenCalled();
  });

  it("rejects OUT_OF_CREDITS for users", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    requireUserTaskAccessMock.mockResolvedValue(createTask());

    const app = createApp({
      actor: "user",
      userId: USER_ID,
      organizationId: null,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects org member status changes on tasks they do not own", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    requireUserTaskAccessMock.mockRejectedValue(
      new HTTPException(404, { message: "Task not found" }),
    );

    const app = createApp({
      actor: "user",
      userId: "user_789",
      organizationId: "org_123",
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.CANCELED,
        comment: "Trying to stop teammate task",
      }),
    });

    expect(response.status).toBe(404);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
    expect(requireUserTaskAccessMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_789",
        organizationId: "org_123",
      },
      TASK_ID,
      expect.any(Object),
    );
    expect(requireTaskCollaboratorAccessMock).not.toHaveBeenCalled();
  });

  it("fails COMPLETED for coworkers when credits are insufficient", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    requireCoworkerTaskAccessMock.mockResolvedValue(createTask());
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        credits: 2,
      }),
    });

    expect(response.status).toBe(422);
    expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cents: convertCreditsToCents(2),
      }),
    );
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects RUNNING events with credits", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    requireCoworkerTaskAccessMock.mockResolvedValue(
      createTask({
        status: TaskStatus.READY,
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.RUNNING,
        credits: 2,
      }),
    });

    expect(response.status).toBe(400);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects COMPLETED with credits below minimum (rounds to zero)", async () => {
    const tx: TransactionMock = {
      taskEvent: { create: vi.fn() },
      task: { updateMany: vi.fn() },
    };

    mockTransaction(tx);
    requireCoworkerTaskAccessMock.mockResolvedValue(createTask());

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        credits: LIMITS.MIN_CHARGEABLE_CREDITS / 10,
      }),
    });

    expect(response.status).toBe(400);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });
});
