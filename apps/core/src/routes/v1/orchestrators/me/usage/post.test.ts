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
  organizationId: string | null;
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
    organizationId: null,
    cents: 25000000000n,
    transactionId: "txn_123",
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "orchestrator",
      orchestratorId: ORCHESTRATOR_ID,
    });

    return await next();
  });

  mountPostOrchestratorMeUsage(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("POST /orchestrators/me/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareConsumptionMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when userId is missing", async () => {
    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: null,
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(400);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("creates usage and bills the request userId", async () => {
    const usage = createUsage();
    serializableTransactionMock.mockImplementation(async (callback) => {
      const tx = {
        orchestratorUsage: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(usage),
        },
        member: {
          findUnique: vi.fn(),
        },
        transaction: {
          create: vi.fn().mockResolvedValue({ id: "txn_123" }),
        },
      };
      return callback(tx);
    });

    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        organizationId: null,
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.userId).toBe(TARGET_USER_ID);
    expect(body.data.orchestratorId).toBe(ORCHESTRATOR_ID);
    expect(body.data.credits).toBe(2.5);
  });
});
