import { OpenAPIHono } from "@hono/zod-openapi";
import { Channel, NotificationKind, TaskStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostTaskEvents from "./post";

const {
  calculateCentsFromMasumiAmountStringsMock,
  createNotificationMock,
  processTaskPaymentClaimMock,
  createTaskPaymentClaimMock,
  createTaskEventTransactionMock,
  getCardanoV2ReadySourcesMock,
  getCreditCostsOrThrowMock,
  orchestratorFindFirstMock,
  prismaTaskFindUniqueMock,
  prismaTransactionMock,
  publishTaskEventDataMock,
  requireTaskCommentAccessMock,
  requireTaskCollaborationMock,
  requireTaskCancelAccessMock,
  waitUntilCapturedPromises,
} = vi.hoisted(() => ({
  calculateCentsFromMasumiAmountStringsMock: vi.fn(),
  createNotificationMock: vi.fn(),
  processTaskPaymentClaimMock: vi.fn(),
  createTaskPaymentClaimMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
  getCardanoV2ReadySourcesMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  orchestratorFindFirstMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn().mockResolvedValue({
    id: "tsk_123",
    ownerId: "user_123",
    name: "Test task",
    assignee: { name: "Test coworker" },
    project: { name: "Test project" },
    projectId: "proj_123",
    workspaceId: "ws_123",
    user: { notificationsOptIn: true },
  }),
  prismaTransactionMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  requireTaskCommentAccessMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  requireTaskCancelAccessMock: vi.fn(),
  waitUntilCapturedPromises: [] as Promise<unknown>[],
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
  requireTaskCommentAccess: requireTaskCommentAccessMock,
  requireTaskCancelAccess: requireTaskCancelAccessMock,
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
    orchestrator: {
      findFirst: orchestratorFindFirstMock,
    },
  },
}));

vi.mock("@/helpers/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/agent")>();
  return {
    ...actual,
    getCardanoV2ReadySources: getCardanoV2ReadySourcesMock,
    getCreditCostsOrThrow: getCreditCostsOrThrowMock,
    calculateCentsFromMasumiAmountStrings:
      calculateCentsFromMasumiAmountStringsMock,
  };
});

vi.mock("@/services/task-payment-claim.service", () => ({
  createTaskPaymentClaim: createTaskPaymentClaimMock,
  processTaskPaymentClaim: processTaskPaymentClaimMock,
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

const V2_READY_POLICY_ID =
  "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";
const V2_READY_CONTRACT_ADDRESS = "addr_test1_ready_contract";

const validV2MasumiPaymentBody = {
  ...validMasumiPaymentBody,
  agentIdentifier: `${V2_READY_POLICY_ID}${"ab".repeat(29)}000002`,
  PaymentSource: {
    network: "Preprod",
    policyId: V2_READY_POLICY_ID,
    smartContractAddress: V2_READY_CONTRACT_ADDRESS,
  },
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
  orchestratorId: string | null;
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
  taskLink?: {
    findMany: ReturnType<typeof vi.fn>;
  };
}

function createTask(
  overrides: Partial<{
    organizationId: string | null;
    assigneeId: string | null;
    status: TaskStatus;
    ownerId: string;
  }> = {},
) {
  return {
    id: TASK_ID,
    status: TaskStatus.RUNNING,
    assigneeId: COWORKER_ID,
    ownerId: USER_ID,
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
    orchestratorId: null,
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
    orchestrator: record.orchestratorId
      ? {
          id: record.orchestratorId,
          name: "Task orchestrator",
          avatarSeed: null,
          userId: USER_ID,
          user: { id: USER_ID, name: "Task user", image: null },
        }
      : null,
    transaction: null as { amount: bigint } | null,
  };
}

function mockTransaction(tx: TransactionMock) {
  if (!tx.taskLink) {
    tx.taskLink = {
      findMany: vi.fn().mockResolvedValue([]),
    };
  }

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
    orchestratorFindFirstMock.mockResolvedValue(null);
    createNotificationMock.mockResolvedValue({
      notification: { id: "notif_1" },
      created: true,
    });
    publishTaskEventDataMock.mockResolvedValue(undefined);
    // Default: V2 rail purchase-ready (individual tests override to []).
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: V2_READY_POLICY_ID,
        smartContractAddress: V2_READY_CONTRACT_ADDRESS,
      },
    ]);
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
    processTaskPaymentClaimMock.mockResolvedValue({
      status: "purchased",
      purchaseId: "pur_task_1",
    });
    createTaskPaymentClaimMock.mockResolvedValue("claim-task-1");
    prismaTaskFindUniqueMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      name: "Test task",
      assignee: { name: "Test coworker" },
      project: { name: "Test project" },
      projectId: "proj_123",
      workspaceId: "ws_123",
      owner: { notificationsOptIn: true },
    });
    requireTaskCollaborationMock.mockResolvedValue(createTask());
    requireTaskCommentAccessMock.mockResolvedValue(createTask());
    requireTaskCancelAccessMock.mockResolvedValue(createTask());
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
      cents: convertCreditsToCents(2),
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
    expect(body.data.credits).toBe(2);
    expect(body.attemptedCredits).toBe(2);
    expect(body.requestedStatus).toBe(TaskStatus.COMPLETED);
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
          cents: convertCreditsToCents(2),
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
      cents: convertCreditsToCents(2),
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
    expect(body.data.credits).toBe(2);
    expect(body.attemptedCredits).toBe(2);
    expect(body.requestedStatus).toBe(TaskStatus.CANCELED);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: convertCreditsToCents(2),
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
      cents: convertCreditsToCents(5),
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
    expect(body.data.credits).toBe(5);
    expect(body.attemptedCredits).toBe(5);
    expect(body.requestedStatus).toBeNull();
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: convertCreditsToCents(5),
          transactionId: null,
        }),
      }),
    );
  });

  it("auto-sets OUT_OF_CREDITS when masumiPayment charge is insufficient", async () => {
    const createdEvent = createTaskEvent({
      status: TaskStatus.OUT_OF_CREDITS,
      cents: convertCreditsToCents(5),
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
    expect(body.data.credits).toBe(5);
    expect(body.attemptedCredits).toBe(5);
    expect(body.requestedStatus).toBe(TaskStatus.COMPLETED);
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: convertCreditsToCents(5),
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
      cents: convertCreditsToCents(4),
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
    expect(body.data.credits).toBe(4);
    expect(body.attemptedCredits).toBe(4);
    expect(body.requestedStatus).toBeNull();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.OUT_OF_CREDITS,
          cents: convertCreditsToCents(4),
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
      createTask({ status: TaskStatus.CANCELED, assigneeId: null }),
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

  it("reopens COMPLETED → READY for delegated coworker user-context with a comment", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.READY,
            comment: "Continue via delegated reopen",
            userId: null,
            coworkerId: COWORKER_ID,
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

    // SOK-631 actor is "user (session / user context)". Delegated coworker
    // keys with context headers use the user transition table + comment gate.
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
        status: TaskStatus.READY,
        comment: "Continue via delegated reopen",
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.READY,
          comment: "Continue via delegated reopen",
          userId: null,
          coworkerId: COWORKER_ID,
        }),
      }),
    );

    const body = await response.json();
    expect(body.data.actor).toEqual({
      type: "coworker",
      id: COWORKER_ID,
      coworker: {
        id: COWORKER_ID,
        name: "Task coworker",
        image: null,
        slug: "task-coworker",
      },
    });
  });

  it("attributes orchestrator DRAFT → READY status to orchestratorId only", async () => {
    const ORCHESTRATOR_ID = "01960001-0001-7001-8001-000000000099";
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.READY,
            comment: null,
            userId: null,
            coworkerId: null,
            orchestratorId: ORCHESTRATOR_ID,
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction(tx);
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.DRAFT }),
    );
    orchestratorFindFirstMock.mockResolvedValue({
      id: ORCHESTRATOR_ID,
      userId: USER_ID,
      archivedAt: null,
    });

    const app = createApp({
      actor: "orchestrator",
      orchestratorId: ORCHESTRATOR_ID,
      context: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.READY,
          userId: null,
          coworkerId: null,
          orchestratorId: ORCHESTRATOR_ID,
        }),
      }),
    );

    const body = await response.json();
    expect(body.data.actor).toEqual({
      type: "orchestrator",
      id: ORCHESTRATOR_ID,
      orchestrator: {
        id: ORCHESTRATOR_ID,
        name: "Task orchestrator",
        avatarSeed: null,
        owner: { id: USER_ID, name: "Task user", image: null },
      },
    });
  });

  it("rejects orchestrator status events when orchestratorId is unbound", async () => {
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
      createTask({ status: TaskStatus.DRAFT }),
    );

    // Service token + context user, but no active per-user instance bound
    // (archived / never activated). Same fail-closed rule as task create.
    const app = createApp({
      actor: "orchestrator",
      context: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "No active orchestrator instance for context user",
    );
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects orchestrator status when middleware snapshot is stale after purge", async () => {
    const ORCHESTRATOR_ID = "01960001-0001-7001-8001-000000000099";
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
      createTask({ status: TaskStatus.DRAFT }),
    );
    orchestratorFindFirstMock.mockResolvedValue(null);

    const app = createApp({
      actor: "orchestrator",
      orchestratorId: ORCHESTRATOR_ID,
      context: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.READY,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "No active orchestrator instance for context user",
    );
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("rejects orchestrator comment events when orchestratorId is unbound", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn(),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    requireTaskCommentAccessMock.mockResolvedValue(
      createTask({ status: TaskStatus.DRAFT }),
    );

    const app = createApp({
      actor: "orchestrator",
      context: {
        userId: USER_ID,
        organizationId: null,
      },
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: "still trying after purge",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "No active orchestrator instance for context user",
    );
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("rejects agent COMPLETED → READY (agent reopen is to RUNNING only)", async () => {
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
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.READY,
        comment: "Agent should not reopen to ready",
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

  it("charges credit-only on CANCELED task without changing status", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            cents: convertCreditsToCents(4),
            transactionId: "txn_credit_only_canceled",
          }),
        ),
      },
      task: {
        updateMany: vi.fn(),
      },
    };

    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue(
      "txn_credit_only_canceled",
    );
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
        credits: 4,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskEventTransactionMock).toHaveBeenCalled();
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
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
    expect(createTaskEventTransactionMock).toHaveBeenCalled();
    expect(createTaskPaymentClaimMock).toHaveBeenCalledWith({
      network: "Preprod",
      blockchainIdentifier: validMasumiPaymentBody.blockchainIdentifier,
      purchasePayload: expect.objectContaining({
        blockchainIdentifier: validMasumiPaymentBody.blockchainIdentifier,
        metadata: JSON.stringify({
          taskId: TASK_ID,
          taskEventId: "evt_running_masumi",
        }),
      }),
      taskEventId: "evt_running_masumi",
      transactionId: "txn_masumi_running",
      tx,
    });
    await Promise.all(waitUntilCapturedPromises);
    expect(processTaskPaymentClaimMock).toHaveBeenCalledWith("claim-task-1");
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
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("persists and warns for an explicitly allowed HTTP authentication URL", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING }),
    );
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_http_auth",
            status: TaskStatus.AUTHENTICATION_REQUIRED,
            authenticationUrl: "http://service.secured-network/oauth/authorize",
          }),
        ),
      },
      task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "http://service.secured-network/oauth/authorize",
        allowInsecureAuthenticationUrl: true,
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authenticationUrl: "http://service.secured-network/oauth/authorize",
        }),
      }),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[tasks] insecure HTTP authentication URL explicitly allowed",
      expect.objectContaining({
        taskId: TASK_ID,
        taskEventId: "evt_http_auth",
        authenticationHost: "service.secured-network",
      }),
    );
    consoleWarnSpy.mockRestore();
  });

  it("rejects replaying the same Masumi blockchain identifier", async () => {
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
    createTaskPaymentClaimMock
      .mockResolvedValueOnce("claim-task-first")
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          meta: { target: ["blockchainIdentifier"] },
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
    expect(second.status).toBe(409);
    expect(createTaskEventTransactionMock).toHaveBeenCalledTimes(2);
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
    expect(tx.taskEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("allows only one concurrent delivery of the same Masumi payment", async () => {
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: null,
            cents: convertCreditsToCents(5),
            transactionId: "txn_masumi_concurrent",
          }),
        ),
      },
      task: { updateMany: vi.fn() },
    };
    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_masumi_concurrent");
    createTaskPaymentClaimMock
      .mockResolvedValueOnce("claim-task-concurrent")
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          meta: { target: ["network", "blockchainIdentifier"] },
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
    const request = () =>
      app.request(`http://localhost/${TASK_ID}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masumiPayment: validMasumiPaymentBody }),
      });

    const responses = await Promise.all([request(), request()]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a V2 masumiPayment before charging when no ready V2 source is cached", async () => {
    getCardanoV2ReadySourcesMock.mockResolvedValue([]);
    const chargeSpy = vi.fn();
    const tx: TransactionMock = {
      taskEvent: {
        create: chargeSpy,
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
        masumiPayment: {
          ...validMasumiPaymentBody,
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 2,
        },
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      "Cardano V2 payments are not enabled",
    );
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed V2 identifier before charging", async () => {
    const chargeSpy = vi.fn();
    const tx: TransactionMock = {
      taskEvent: {
        create: chargeSpy,
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
        masumiPayment: {
          ...validV2MasumiPaymentBody,
          agentIdentifier: `${V2_READY_POLICY_ID}abcd`,
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 2,
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
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
        masumiPayment: {
          ...validV2MasumiPaymentBody,
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 2,
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
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
    expect(createTaskPaymentClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "Preprod",
        purchasePayload: expect.objectContaining({
          blockchainIdentifier: validMasumiPaymentBody.blockchainIdentifier,
          identifierFromPurchaser:
            validMasumiPaymentBody.identifierFromPurchaser,
          Amounts: validMasumiPaymentBody.Amounts,
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 2,
          metadata: expect.stringContaining(TASK_ID),
        }),
      }),
    );
    const createPayload = tx.taskEvent.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createPayload?.data).not.toHaveProperty("id");
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a V2 masumiPayment whose payment source tuple is not purchase-ready", async () => {
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: V2_READY_POLICY_ID,
        smartContractAddress: "addr_test1_other_contract",
      },
    ]);
    const chargeSpy = vi.fn();
    const tx: TransactionMock = {
      taskEvent: {
        create: chargeSpy,
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
        masumiPayment: {
          ...validV2MasumiPaymentBody,
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 2,
        },
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("not purchase-ready");
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
  });

  it("does not V2-gate a V1 masumiPayment with a bare index and PaymentSource tuple", async () => {
    // PaymentSource predates the V2 gate on this public API; a V1 caller
    // echoing its V1 source tuple must charge as V1 without any readiness
    // consultation (regression guard for the compat break found in review).
    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            id: "evt_v1_source",
            status: TaskStatus.COMPLETED,
            cents: null,
            transactionId: "txn_masumi_v1",
          }),
        ),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockTransaction(tx);
    createTaskEventTransactionMock.mockResolvedValue("txn_masumi_v1");

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
        masumiPayment: {
          ...validMasumiPaymentBody,
          supportedPaymentSourceIndex: 0,
          PaymentSource: {
            network: "Preprod",
            policyId: validMasumiPaymentBody.agentIdentifier.slice(0, 56),
            smartContractAddress: "addr_test1_v1_escrow_contract",
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(getCardanoV2ReadySourcesMock).not.toHaveBeenCalled();
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
    // The V1 tuple is informational — its address must NOT be forwarded to
    // the node (an unoperated address would fail the purchase post-charge).
    expect(createTaskPaymentClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purchasePayload: expect.objectContaining({
          smartContractAddress: undefined,
          supportedPaymentSourceIndex: undefined,
        }),
      }),
    );
  });

  it("rejects an odd-length hex identifierFromPurchaser before charging", async () => {
    const chargeSpy = vi.fn();
    const tx: TransactionMock = {
      taskEvent: {
        create: chargeSpy,
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
        masumiPayment: {
          ...validMasumiPaymentBody,
          // 15 hex chars: within 14-26 but not whole bytes — the node
          // rejects it, so the schema must too (before any charge).
          identifierFromPurchaser: "aabbccddeeff001",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
  });

  it("rejects an inferred-V2 masumiPayment that omits PaymentSource", async () => {
    const chargeSpy = vi.fn();
    const tx: TransactionMock = {
      taskEvent: {
        create: chargeSpy,
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

    // No paymentSourceType, index, or PaymentSource — V2 is inferred from the
    // registry policy prefix of the agent identifier alone.
    const { PaymentSource: _paymentSource, ...inferredV2Body } =
      validV2MasumiPaymentBody;
    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: TaskStatus.COMPLETED,
        masumiPayment: inferredV2Body,
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("must include PaymentSource");
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
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
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
    await Promise.all(waitUntilCapturedPromises);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 201 and publishes when durable processor refunds a permanent failure", async () => {
    processTaskPaymentClaimMock.mockResolvedValue({
      status: "refunded",
      reason: "payment API error",
      compensated: true,
    });

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
    expect(processTaskPaymentClaimMock).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(1);
    await Promise.all(waitUntilCapturedPromises);
    expect(processTaskPaymentClaimMock).toHaveBeenCalledWith("claim-task-1");
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
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
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
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
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
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
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
      assigneeId: "cow_sibling",
      ownerId: BOB_USER_ID,
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
      createTask({ status: TaskStatus.READY, assigneeId: COWORKER_ID }),
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
    requireTaskCancelAccessMock.mockResolvedValue(
      createTask({ status: TaskStatus.READY, assigneeId: COWORKER_ID }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.CANCELED,
            userId: null,
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
    expect(requireTaskCancelAccessMock).toHaveBeenCalled();
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.CANCELED,
          userId: null,
          coworkerId: COWORKER_ID,
        }),
      }),
    );
  });

  it("lets an org workspace member cancel another member's task", async () => {
    requireTaskCancelAccessMock.mockResolvedValue(
      createTask({
        status: TaskStatus.RUNNING,
        ownerId: "user_owner",
        assigneeId: COWORKER_ID,
      }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi.fn().mockResolvedValue(
          createTaskEvent({
            status: TaskStatus.CANCELED,
            userId: "user_member",
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
      actor: "user",
      userId: "user_member",
      organizationId: "org_123",
      role: "user",
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.CANCELED,
      }),
    });

    expect(response.status).toBe(201);
    expect(requireTaskCancelAccessMock).toHaveBeenCalled();
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.CANCELED,
          userId: "user_member",
          coworkerId: null,
        }),
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalled();
  });

  it("keeps cancel with credits on collaboration for org peers", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({
        status: TaskStatus.RUNNING,
        ownerId: "user_owner",
        assigneeId: null,
      }),
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
      userId: "user_member",
      organizationId: "org_123",
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
    expect(requireTaskCollaborationMock).toHaveBeenCalled();
    expect(requireTaskCancelAccessMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("keeps non-cancel status writes on collaboration for org peers", async () => {
    requireTaskCollaborationMock.mockRejectedValue(
      new HTTPException(404, { message: "Task not found" }),
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
      userId: "user_member",
      organizationId: "org_123",
      role: "user",
    });

    const response = await app.request(`http://localhost/${TASK_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: TaskStatus.READY,
        comment: "please reopen",
      }),
    });

    expect(response.status).toBe(404);
    expect(requireTaskCollaborationMock).toHaveBeenCalled();
    expect(requireTaskCancelAccessMock).not.toHaveBeenCalled();
  });

  it("rejects credits from a user session canceling a task", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.READY, assigneeId: null }),
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
    expect(requireTaskCollaborationMock).toHaveBeenCalled();
    expect(requireTaskCancelAccessMock).not.toHaveBeenCalled();
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("rejects masumiPayment from a delegated coworker", async () => {
    requireTaskCollaborationMock.mockResolvedValue(
      createTask({ status: TaskStatus.RUNNING, assigneeId: COWORKER_ID }),
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
    expect(processTaskPaymentClaimMock).not.toHaveBeenCalled();
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
  });

  it("clears schedule fields when canceling a queued task", async () => {
    requireTaskCancelAccessMock.mockResolvedValue(
      createTask({ status: TaskStatus.QUEUED }),
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
      taskLink: {
        findMany: vi.fn().mockResolvedValue([]),
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
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID, status: TaskStatus.QUEUED },
        data: {
          status: TaskStatus.CANCELED,
          metadata: null,
          nextRunAt: null,
        },
      }),
    );
    expect(tx.taskLink?.findMany).toHaveBeenCalled();
  });

  it("cascades cancel to non-terminal SCHEDULE runs", async () => {
    requireTaskCancelAccessMock.mockResolvedValue(
      createTask({ status: TaskStatus.QUEUED }),
    );

    const tx: TransactionMock = {
      taskEvent: {
        create: vi
          .fn()
          .mockResolvedValueOnce(
            createTaskEvent({
              id: "evt_parent",
              status: TaskStatus.CANCELED,
              userId: USER_ID,
              coworkerId: null,
            }),
          )
          .mockResolvedValueOnce(
            createTaskEvent({
              id: "evt_child",
              status: TaskStatus.CANCELED,
              userId: USER_ID,
              coworkerId: null,
            }),
          ),
      },
      task: {
        updateMany: vi
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      taskLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            toTask: {
              id: "tsk_child",
              status: TaskStatus.RUNNING,
              ownerId: USER_ID,
            },
          },
        ]),
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
      }),
    });

    expect(response.status).toBe(201);
    expect(tx.taskEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.task.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.task.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "tsk_child", status: TaskStatus.RUNNING },
        data: {
          status: TaskStatus.CANCELED,
          metadata: null,
          nextRunAt: null,
        },
      }),
    );
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(2);
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: USER_ID,
      taskId: TASK_ID,
      eventType: "task_event",
    });
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: USER_ID,
      taskId: "tsk_child",
      eventType: "task_event",
    });
  });
});
