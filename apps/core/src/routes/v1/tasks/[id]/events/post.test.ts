import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin } from "@sokosumi/database";
import { convertCreditsToCents, TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountPostTaskEvents from "./post";

const {
  calculateCentsFromMasumiAmountStringsMock,
  createPurchaseFromMasumiTaskPaymentMock,
  createTaskEventTransactionMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
  publishTaskEventDataMock,
  requireTaskCollaborationMock,
} = vi.hoisted(() => ({
  calculateCentsFromMasumiAmountStringsMock: vi.fn(),
  createPurchaseFromMasumiTaskPaymentMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
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

vi.mock("@/helpers/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/agent")>();
  return {
    ...actual,
    getCreditCostsOrThrow: getCreditCostsOrThrowMock,
    calculateCentsFromMasumiAmountStrings:
      calculateCentsFromMasumiAmountStringsMock,
  };
});

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    createPurchaseFromMasumiTaskPayment:
      createPurchaseFromMasumiTaskPaymentMock,
  }),
}));

const TASK_ID = "tsk_123";
const USER_ID = "user_123";
const COWORKER_ID = "cow_123";

const validMasumiPaymentBody = {
  blockchainIdentifier: "0b00e04c0860a60c61066056281180462d0b12",
  identifierFromPurchaser: "aabbccddeeff00112233",
  agentIdentifier: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
  sellerVkey: "0bde475ace6b116298363b268309fa62172f7208625a9a83eeaffdbd",
  submitResultTime: "1775681853000",
  payByTime: "1775737949000",
  unlockTime: "1775763149000",
  externalDisputeUnlockTime: "1775784749000",
  inputHash: "3b2d456a720bf5b3e2cc2cebaea9f9a937cd8b4d64267da3271bca937cb56af1",
  Amounts: [
    {
      amount: "470000000000",
      unit: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
    },
  ],
} as const;

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
}

interface TransactionMock {
  taskEvent: {
    create: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
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
    return await next();
  });

  mountPostTaskEvents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function enrichTaskEventRowForResponse(record: TaskEventRecord) {
  return {
    ...record,
    user: record.userId
      ? { id: record.userId, name: "Task user", image: null }
      : null,
    coworker: record.coworkerId
      ? {
          id: record.coworkerId,
          name: "Task coworker",
          image: null,
          slug: "task-coworker",
        }
      : null,
    transaction: null as { amount: bigint } | null,
  };
}

function mockTransaction(tx: TransactionMock) {
  const innerCreate = tx.taskEvent.create;
  const findUnique = (tx.taskEvent.findUnique ??= vi.fn());
  tx.taskEvent.create = vi
    .fn()
    .mockImplementation(async (...args: unknown[]) => {
      const raw = await Promise.resolve(
        (innerCreate as (...a: unknown[]) => unknown)(...args),
      );
      if (raw == null) {
        return raw;
      }
      const created = raw as TaskEventRecord;
      findUnique.mockResolvedValue(enrichTaskEventRowForResponse(created));
      return created;
    });

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
    getCreditCostsOrThrowMock.mockResolvedValue([
      {
        id: "cc_1",
        createdAt: new Date(),
        updatedAt: new Date(),
        unit: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
        centsPerUnit: 1n,
      },
    ]);
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(
      convertCreditsToCents(5),
    );
    createPurchaseFromMasumiTaskPaymentMock.mockResolvedValue(
      ok({ id: "pur_task_1" } as { id: string }),
    );
    requireTaskCollaborationMock.mockResolvedValue(createTask());
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
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.OUT_OF_CREDITS },
      }),
    );
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

    const app = createApp({
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
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
    requireTaskCollaborationMock.mockResolvedValue(
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

  it("creates purchase when coworker completes with masumiPayment", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_123",
            status: TaskStatus.COMPLETED,
            cents: null,
            transactionId: "txn_masumi",
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_masumi");

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
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(201);
    expect(createPurchaseFromMasumiTaskPaymentMock).toHaveBeenCalledTimes(1);
    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(getCreditCostsOrThrowMock).toHaveBeenCalled();
    expect(calculateCentsFromMasumiAmountStringsMock).toHaveBeenCalledWith(
      validMasumiPaymentBody.Amounts,
      expect.anything(),
    );
    expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cents: convertCreditsToCents(5),
      }),
    );
    expect(createPurchaseFromMasumiTaskPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        blockchainIdentifier: validMasumiPaymentBody.blockchainIdentifier,
        identifierFromPurchaser: validMasumiPaymentBody.identifierFromPurchaser,
        Amounts: validMasumiPaymentBody.Amounts,
        metadata: expect.stringContaining(TASK_ID),
      }),
    );
    const createPayload = tx.taskEvent.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createPayload?.data).not.toHaveProperty("id");
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(1);
  });

  it("returns 201 and publishes when async Masumi purchase fails (fire-and-forget)", async () => {
    createPurchaseFromMasumiTaskPaymentMock.mockResolvedValue(
      err("payment API error"),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_masumi_fail",
            status: TaskStatus.COMPLETED,
            transactionId: "txn_fail",
          }),
        ),
      },
      task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_fail");

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(201);
    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(tx.taskEvent.create).toHaveBeenCalled();
    expect(createTaskEventTransactionMock).toHaveBeenCalled();
    expect(createPurchaseFromMasumiTaskPaymentMock).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(1);
  });

  it("rejects masumiPayment together with credits", async () => {
    const tx: TransactionMock = {
      taskEvent: { create: vi.fn() },
      task: { updateMany: vi.fn() },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        credits: 3,
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(400);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("rejects user COMPLETED with masumiPayment (invalid status transition)", async () => {
    const tx: TransactionMock = {
      taskEvent: { create: vi.fn() },
      task: { updateMany: vi.fn() },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
  });

  it("attributes a delegated coworker's comment to the delegated user", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            comment: "On behalf of the user",
            userId: USER_ID,
            coworkerId: null,
          }),
        ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      delegation: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: "On behalf of the user",
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          comment: "On behalf of the user",
          userId: USER_ID,
          coworkerId: null,
        }),
      }),
    );
  });

  it("rejects an agent-only transition for a delegated coworker", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.READY }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      delegation: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.RUNNING,
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects credits from a delegated coworker canceling a task", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.READY, coworkerId: null }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      delegation: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.CANCELED,
        credits: 5,
      }),
    });

    expect(response.status).toBe(422);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("lets a delegated coworker cancel a task without charging", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.READY, coworkerId: null }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.CANCELED,
            userId: USER_ID,
            coworkerId: null,
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      delegation: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.CANCELED,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.CANCELED,
          userId: USER_ID,
          coworkerId: null,
        }),
      }),
    );
  });
});
