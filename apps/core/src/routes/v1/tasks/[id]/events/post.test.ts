import { OpenAPIHono } from "@hono/zod-openapi";
import { Channel, NotificationKind } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  convertCreditsToCents,
  TaskStatus,
} from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostTaskEvents from "./post";

const {
  calculateCentsFromMasumiAmountStringsMock,
  createNotificationMock,
  createPurchaseFromMasumiTaskPaymentMock,
  createTaskEventTransactionMock,
  getCreditCostsOrThrowMock,
  prismaTaskFindUniqueMock,
  prismaTransactionMock,
  publishTaskEventDataMock,
  requireTaskCommentAccessMock,
  requireTaskCollaborationMock,
  waitUntilCapturedPromises,
} = vi.hoisted(() => ({
  calculateCentsFromMasumiAmountStringsMock: vi.fn(),
  createNotificationMock: vi.fn(),
  createPurchaseFromMasumiTaskPaymentMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn().mockResolvedValue({
    id: "tsk_123",
    userId: "user_123",
    name: "Test task",
    coworker: { name: "Test coworker" },
    project: { name: "Test project" },
    projectId: "proj_123",
    workspaceId: "ws_123",
    user: { notificationsOptIn: true },
  }),
  prismaTransactionMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  requireTaskCommentAccessMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  waitUntilCapturedPromises: [] as Promise<unknown>[],
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
  requireTaskCommentAccess: requireTaskCommentAccessMock,
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: createNotificationMock,
}));

vi.mock("@/helpers/task-credits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/task-credits")>();
  return {
    ...actual,
    createTaskEventTransaction: createTaskEventTransactionMock,
  };
});

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilCapturedPromises.push(promise);
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    task: {
      findUnique: prismaTaskFindUniqueMock,
    },
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
const BOB_USER_ID = "user_bob";
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
  channel: Channel;
  userId: string | null;
  coworkerId: string | null;
  transactionId: string | null;
  cents: bigint | null;
}

interface TransactionMock {
  taskEvent: {
    create: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
    findFirst?: ReturnType<typeof vi.fn>;
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
    channel: Channel.SOKOSUMI,
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
  tx.taskEvent.findFirst ??= vi.fn().mockResolvedValue(null);
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
    waitUntilCapturedPromises.length = 0;
    createNotificationMock.mockResolvedValue({
      notification: { id: "notif_1" },
      created: true,
    });
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
    prismaTaskFindUniqueMock.mockResolvedValue({
      id: "tsk_123",
      userId: "user_123",
      name: "Test task",
      coworker: { name: "Test coworker" },
      project: { name: "Test project" },
      projectId: "proj_123",
      workspaceId: "ws_123",
      user: { notificationsOptIn: true },
    });
    requireTaskCollaborationMock.mockResolvedValue(createTask());
    requireTaskCommentAccessMock.mockResolvedValue(createTask());
  });

  it("rejects coworkers creating OUT_OF_CREDITS events manually", async () => {
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
      vendorId: TEST_VENDOR_ID,
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

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("creates an in-app notification for user-meaningful status transitions", async () => {
    const createdEvent = createTaskEvent({
      id: "event_input_required",
      status: TaskStatus.INPUT_REQUIRED,
    });
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(createdEvent),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.INPUT_REQUIRED,
        comment: "Need input",
      }),
    });

    expect(response.status).toBe(201);
    expect(waitUntilCapturedPromises).toHaveLength(1);
    await waitUntilCapturedPromises[0];

    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: USER_ID,
      kind: NotificationKind.TASK,
      referenceId: TASK_ID,
      eventId: "event_input_required",
      messageKey: "Notifications.Task.inputRequired",
      messageParams: {
        coworkerName: "Test coworker",
        taskName: "Test task",
        projectName: "Test project",
      },
      metadata: {
        projectId: "proj_123",
        workspaceId: "ws_123",
      },
    });
  });

  it("returns 409 when the serializable transaction hits a write conflict", async () => {
    prismaTransactionMock.mockRejectedValueOnce(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.INPUT_REQUIRED,
        comment: "Need input",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("returns 409 when the pg adapter reports a write conflict", async () => {
    prismaTransactionMock.mockRejectedValueOnce(
      Object.assign(new Error("TransactionWriteConflict"), {
        name: "DriverAdapterError",
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.INPUT_REQUIRED,
        comment: "Need input",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("rethrows non-conflict transaction errors as 500", async () => {
    prismaTransactionMock.mockRejectedValueOnce(new Error("Connection lost"));

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.INPUT_REQUIRED,
        comment: "Need input",
      }),
    });

    expect(response.status).toBe(500);
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

  it("auto-sets OUT_OF_CREDITS when COMPLETED credits are insufficient", async () => {
    const createdEvent = createTaskEvent({
      status: TaskStatus.OUT_OF_CREDITS,
    });
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(createdEvent),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        credits: 2,
        comment: "Done but unpaid",
      }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE);
    expect(body.data.status).toBe(TaskStatus.OUT_OF_CREDITS);
    expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cents: convertCreditsToCents(2),
      }),
    );
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          comment: "Done but unpaid",
          cents: undefined,
          transactionId: null,
          coworkerId: COWORKER_ID,
        }),
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.OUT_OF_CREDITS },
      }),
    );
  });

  it("auto-sets OUT_OF_CREDITS when CANCELED credits are insufficient", async () => {
    const createdEvent = createTaskEvent({
      status: TaskStatus.OUT_OF_CREDITS,
    });
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(createdEvent),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.CANCELED,
        credits: 2,
      }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE);
    expect(body.data.status).toBe(TaskStatus.OUT_OF_CREDITS);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: undefined,
          transactionId: null,
        }),
      }),
    );
  });

  it("auto-sets OUT_OF_CREDITS when masumiPayment charge is insufficient on RUNNING", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );
    const createdEvent = createTaskEvent({
      status: TaskStatus.OUT_OF_CREDITS,
    });
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(createdEvent),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE);
    expect(body.data.status).toBe(TaskStatus.OUT_OF_CREDITS);
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: undefined,
          transactionId: null,
        }),
      }),
    );
  });

  it("auto-sets OUT_OF_CREDITS when masumiPayment charge is insufficient", async () => {
    const createdEvent = createTaskEvent({
      status: TaskStatus.OUT_OF_CREDITS,
    });
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(createdEvent),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
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

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE);
    expect(body.data.status).toBe(TaskStatus.OUT_OF_CREDITS);
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: undefined,
          transactionId: null,
        }),
      }),
    );
  });

  it("still rejects insufficient credits when task is already OUT_OF_CREDITS", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.OUT_OF_CREDITS }),
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
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
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
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("allows multiple sequential credit charges on the same task", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi
          .fn()
          .mockResolvedValueOnce(
            createTaskEvent({
              status: null,
              cents: convertCreditsToCents(2),
              transactionId: "txn_first",
            }),
          )
          .mockResolvedValueOnce(
            createTaskEvent({
              status: null,
              cents: convertCreditsToCents(3),
              transactionId: "txn_second",
            }),
          ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock
      .mockResolvedValueOnce("txn_first")
      .mockResolvedValueOnce("txn_second");
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const first = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credits: 2 }),
    });
    const second = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credits: 3 }),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(createTaskEventTransactionMock).toHaveBeenCalledTimes(2);
    expect(tx.taskEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("auto-sets OUT_OF_CREDITS on credit-only when balance is insufficient mid-run", async () => {
    const createdEvent = createTaskEvent({
      status: TaskStatus.OUT_OF_CREDITS,
    });
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(createdEvent),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockRejectedValue(
      new HTTPException(422, {
        message: "Insufficient balance",
        cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
      }),
    );
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credits: 4 }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE);
    expect(body.data.status).toBe(TaskStatus.OUT_OF_CREDITS);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: undefined,
          transactionId: null,
        }),
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.OUT_OF_CREDITS },
      }),
    );
  });

  it.each([TaskStatus.FAILED, TaskStatus.COMPLETED, TaskStatus.CANCELED])(
    "rejects insufficient credit-only charges on %s without changing status",
    async (status) => {
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
          cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
        }),
      );
      requireTaskCollaborationMock.mockResolvedValue(createTask({ status }));

      const app = createApp({
        actor: "coworker",
        coworkerId: COWORKER_ID,
        vendorId: TEST_VENDOR_ID,
      });

      const response = await app.request(`http://localhost/${TASK_ID}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: 4 }),
      });

      expect(response.status).toBe(422);
      expect(tx.taskEvent.create).not.toHaveBeenCalled();
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    },
  );

  it("reopens COMPLETED → READY for users with a comment", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.READY,
            comment: "Please continue with the revised brief",
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
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.COMPLETED }),
    );

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
        status: TaskStatus.READY,
        comment: "  Please continue with the revised brief  ",
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.READY,
          comment: "Please continue with the revised brief",
        }),
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.READY },
      }),
    );
  });

  it("reopens CANCELED → READY for users with a comment", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.READY,
            comment: "Need another pass",
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
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.CANCELED }),
    );

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
        status: TaskStatus.READY,
        comment: "Need another pass",
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.READY },
      }),
    );
  });

  it("rejects user COMPLETED → READY without a comment", async () => {
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
      createTask({ status: TaskStatus.COMPLETED }),
    );

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
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects user CANCELED → READY without a comment field", async () => {
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
      createTask({ status: TaskStatus.CANCELED }),
    );

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
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("rejects user CANCELED → READY when the task has no coworker", async () => {
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
      createTask({ status: TaskStatus.CANCELED, coworkerId: null }),
    );

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
        status: TaskStatus.READY,
        comment: "Please continue",
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("rejects user CANCELED → READY with whitespace-only comment", async () => {
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
      createTask({ status: TaskStatus.CANCELED }),
    );

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
        status: TaskStatus.READY,
        comment: "   ",
      }),
    });

    expect(response.status).toBe(422);
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("reopens COMPLETED → RUNNING without credits", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.RUNNING,
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.COMPLETED }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.RUNNING,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.RUNNING },
      }),
    );
  });

  it("reopens CANCELED → RUNNING with credits", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.RUNNING,
            cents: convertCreditsToCents(2),
            transactionId: "txn_reopen",
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_reopen");
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.CANCELED }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.RUNNING,
        credits: 2,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.RUNNING,
          cents: convertCreditsToCents(2),
        }),
      }),
    );
  });

  it("charges credits on mid-run status change", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.RUNNING,
            cents: convertCreditsToCents(2),
            transactionId: "txn_midrun",
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_midrun");
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.READY }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.RUNNING,
        credits: 2,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalled();
  });

  it("creates a credit-only event without changing task status", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            cents: convertCreditsToCents(4),
            transactionId: "txn_credit_only",
          }),
        ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_credit_only");

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credits: 4,
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: null,
          cents: convertCreditsToCents(4),
          coworkerId: COWORKER_ID,
          userId: null,
        }),
      }),
    );
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects FAILED → RUNNING reopen", async () => {
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
      createTask({ status: TaskStatus.FAILED }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
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
  });

  it("rejects credit-only events from non-agent callers", async () => {
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credits: 5,
      }),
    });

    expect(response.status).toBe(422);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("allows zero-credit COMPLETED without charging", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.COMPLETED,
            cents: null,
            transactionId: null,
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
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalled();
  });

  it("charges credits on RUNNING events", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.RUNNING,
            cents: convertCreditsToCents(2),
            transactionId: "txn_running",
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_running");
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({
        status: TaskStatus.READY,
      }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
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

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cents: convertCreditsToCents(2),
      }),
    );
    expect(tx.taskEvent.create).toHaveBeenCalled();
    expect(tx.task.updateMany).toHaveBeenCalled();
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
      vendorId: TEST_VENDOR_ID,
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

  it("creates purchase when coworker charges masumiPayment on RUNNING", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_running_masumi",
            status: null,
            cents: convertCreditsToCents(5),
            transactionId: "txn_masumi_running",
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_masumi_running");

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(201);
    expect(createPurchaseFromMasumiTaskPaymentMock).toHaveBeenCalledTimes(1);
    expect(createTaskEventTransactionMock).toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("accepts charge-only masumiPayment without status change", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_charge_only_masumi",
            status: null,
            cents: convertCreditsToCents(5),
            transactionId: "txn_charge_only",
          }),
        ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_charge_only");

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.status).toBeNull();
    expect(createPurchaseFromMasumiTaskPaymentMock).toHaveBeenCalledTimes(1);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("allows multiple sequential Masumi charges on the same task", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi
          .fn()
          .mockResolvedValueOnce(
            createTaskEvent({
              status: null,
              cents: convertCreditsToCents(5),
              transactionId: "txn_masumi_first",
            }),
          )
          .mockResolvedValueOnce(
            createTaskEvent({
              status: null,
              cents: convertCreditsToCents(5),
              transactionId: "txn_masumi_second",
            }),
          ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock
      .mockResolvedValueOnce("txn_masumi_first")
      .mockResolvedValueOnce("txn_masumi_second");
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );

    const app = createApp({
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const first = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masumiPayment: validMasumiPaymentBody }),
    });
    const second = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masumiPayment: validMasumiPaymentBody }),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(createTaskEventTransactionMock).toHaveBeenCalledTimes(2);
    expect(createPurchaseFromMasumiTaskPaymentMock).toHaveBeenCalledTimes(2);
    expect(tx.taskEvent.create).toHaveBeenCalledTimes(2);
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
      vendorId: TEST_VENDOR_ID,
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

  it("still schedules Masumi purchase when notification lookup fails", async () => {
    prismaTaskFindUniqueMock.mockRejectedValueOnce(
      new Error("notification lookup failed"),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_masumi_notify_fail",
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
      vendorId: TEST_VENDOR_ID,
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
    await Promise.all(waitUntilCapturedPromises);
    expect(createNotificationMock).not.toHaveBeenCalled();
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
      vendorId: TEST_VENDOR_ID,
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
      vendorId: TEST_VENDOR_ID,
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

  it("rejects user COMPLETED with masumiPayment (non-agent gate)", async () => {
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
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
  });

  it("rejects user masumiPayment on a credit-bearing event (non-agent gate)", async () => {
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
        status: TaskStatus.RUNNING,
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(422);
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
  });

  it("attributes a delegated coworker's comment to the acting coworker only", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            comment: "On behalf of the user",
            userId: null,
            coworkerId: COWORKER_ID,
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
      vendorId: TEST_VENDOR_ID,
      context: {
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
          userId: null,
          coworkerId: COWORKER_ID,
        }),
      }),
    );
  });

  it("uses sibling-friendly comment access for delegated coworker comments", async () => {
    const siblingTask = createTask({
      coworkerId: "cow_sibling",
      userId: BOB_USER_ID,
    });
    requireTaskCommentAccessMock.mockResolvedValueOnce(siblingTask);

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            comment: "Sibling note",
            userId: null,
            coworkerId: COWORKER_ID,
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
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: "Sibling note",
      }),
    });

    expect(response.status).toBe(201);
    expect(requireTaskCommentAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authContext: expect.objectContaining({
          coworkerId: COWORKER_ID,
        }),
      }),
      TASK_ID,
      expect.any(Object),
    );
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          comment: "Sibling note",
          userId: null,
          coworkerId: COWORKER_ID,
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
      vendorId: TEST_VENDOR_ID,
      context: {
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
      createTask({ status: TaskStatus.READY, coworkerId: COWORKER_ID }),
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
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: {
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
      createTask({ status: TaskStatus.READY, coworkerId: COWORKER_ID }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.CANCELED,
            userId: USER_ID,
            coworkerId: COWORKER_ID,
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
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: {
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
          coworkerId: COWORKER_ID,
        }),
      }),
    );
  });

  it("rejects credits from a user session canceling a task", async () => {
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
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
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

  it("rejects masumiPayment from a delegated coworker", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING, coworkerId: COWORKER_ID }),
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
      vendorId: TEST_VENDOR_ID,
      context: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.RUNNING,
        masumiPayment: validMasumiPaymentBody,
      }),
    });

    expect(response.status).toBe(422);
    expect(createPurchaseFromMasumiTaskPaymentMock).not.toHaveBeenCalled();
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });
});
