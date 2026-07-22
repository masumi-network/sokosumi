import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostOrchestratorMeUsage from "./post";

const { prepareConsumptionMock, serializableTransactionMock } = vi.hoisted(
  () => ({
    prepareConsumptionMock: vi.fn(),
    serializableTransactionMock: vi.fn(),
  }),
);

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    prepareConsumption: prepareConsumptionMock,
  },
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));

const ORCHESTRATOR_ID = "01960001-0001-7001-8001-000000000099";
const TARGET_USER_ID = "user_456";

interface UsageRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
  referenceId: string | null;
  orchestratorId: string;
  userId: string;
  cents: bigint;
  transactionId: string;
}

function createUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: "01960001-0001-7001-8001-0000000000bb",
    createdAt: new Date("2026-02-20T09:00:00.000Z"),
    updatedAt: new Date("2026-02-20T09:00:00.000Z"),
    idempotencyKey: "usage_456",
    referenceId: null,
    orchestratorId: ORCHESTRATOR_ID,
    userId: TARGET_USER_ID,
    cents: 25000000000n,
    transactionId: "txn_123",
    ...overrides,
  };
}

function createApp(
  actor: "orchestrator" | "user" = "orchestrator",
  authOverrides: { orchestratorId?: string } = {},
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    if (actor === "orchestrator") {
      c.set("authContext", {
        actor: "orchestrator",
        // Service token alone does not bind orchestratorId; usage resolves from body.
        ...authOverrides,
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      });
    }

    return await next();
  });

  mountPostOrchestratorMeUsage(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTxWithActiveOrchestrator(options?: {
  existingUsage?: UsageRecord | null;
  createUsage?: UsageRecord;
}) {
  const findFirst = vi.fn().mockResolvedValue({
    id: ORCHESTRATOR_ID,
    userId: TARGET_USER_ID,
    archivedAt: null,
  });
  const usageCreate = vi
    .fn()
    .mockResolvedValue(options?.createUsage ?? createUsage());
  const usageFindUnique = vi
    .fn()
    .mockResolvedValue(options?.existingUsage ?? null);

  serializableTransactionMock.mockImplementation(async (callback) => {
    const tx = {
      orchestrator: {
        findFirst,
      },
      orchestratorUsage: {
        findUnique: usageFindUnique,
        create: usageCreate,
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn_123" }),
      },
    };
    return callback(tx);
  });

  return { findFirst, usageCreate, usageFindUnique };
}

describe("POST /orchestrators/me/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareConsumptionMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for user session credentials", async () => {
    const response = await createApp("user").request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(403);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when userId is missing", async () => {
    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(400);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("creates usage and bills the request userId using that user's orchestrator", async () => {
    const { findFirst, usageCreate } = mockTxWithActiveOrchestrator();

    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.userId).toBe(TARGET_USER_ID);
    expect(body.data.orchestratorId).toBe(ORCHESTRATOR_ID);
    expect(body.data.credits).toBe(2.5);

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: TARGET_USER_ID, archivedAt: null },
    });
    expect(usageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orchestratorId: ORCHESTRATOR_ID,
          userId: TARGET_USER_ID,
        }),
      }),
    );

    expect(prepareConsumptionMock).toHaveBeenCalledWith(
      TARGET_USER_ID,
      null,
      expect.any(BigInt),
      expect.anything(),
    );
  });

  it("returns 404 when the user has no active orchestrator instance", async () => {
    serializableTransactionMock.mockImplementation(async (callback) => {
      const tx = {
        orchestrator: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        orchestratorUsage: {
          findUnique: vi.fn(),
          create: vi.fn(),
        },
        transaction: { create: vi.fn() },
      };
      return callback(tx);
    });

    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(404);
  });
});
