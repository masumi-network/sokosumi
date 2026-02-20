import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostCoworkerMeUsage from "./post";

const { prepareConsumptionMock, prismaTransactionMock } = vi.hoisted(() => ({
  prepareConsumptionMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    prepareConsumption: prepareConsumptionMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const AUTH_USER_ID = "auth_user_123";
const COWORKER_ID = "cow_123";
const TARGET_USER_ID = "user_456";
const ORGANIZATION_ID = "org_123";

interface UsageRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
  referenceId: string | null;
  coworkerId: string;
  userId: string;
  organizationId: string | null;
  cents: bigint;
  transactionId: string;
}

interface TransactionMock {
  coworkerUsage: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  transaction: {
    create: ReturnType<typeof vi.fn>;
  };
}

function createUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: "usage_123",
    createdAt: new Date("2026-02-20T09:00:00.000Z"),
    updatedAt: new Date("2026-02-20T09:00:00.000Z"),
    idempotencyKey: "usage_456",
    referenceId: null,
    coworkerId: COWORKER_ID,
    userId: TARGET_USER_ID,
    organizationId: ORGANIZATION_ID,
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
      userId: AUTH_USER_ID,
      organizationId: ORGANIZATION_ID,
      coworkerId: COWORKER_ID,
    });

    return await next();
  });

  mountPostCoworkerMeUsage(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

describe("POST /me/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when userId is missing", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/me/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "usage_missing_user",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("creates usage and bills the request userId", async () => {
    const tx: TransactionMock = {
      coworkerUsage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockResolvedValue(createUsage({ userId: TARGET_USER_ID })),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn_123" }),
      },
    };

    mockTransaction(tx);
    prepareConsumptionMock.mockResolvedValue([
      { bucketId: "bucket_123", amount: 25000000000n },
    ]);

    const app = createApp();

    const response = await app.request("http://localhost/me/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "usage_456",
        credits: 2.5,
        userId: TARGET_USER_ID,
      }),
    });

    expect(response.status).toBe(201);
    expect(prepareConsumptionMock).toHaveBeenCalledTimes(1);
    expect(prepareConsumptionMock.mock.calls[0]?.[0]).toBe(TARGET_USER_ID);
    expect(prepareConsumptionMock.mock.calls[0]?.[1]).toBe(ORGANIZATION_ID);
    expect(typeof prepareConsumptionMock.mock.calls[0]?.[2]).toBe("bigint");
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user: { connect: { id: TARGET_USER_ID } },
        }),
      }),
    );
    expect(tx.coworkerUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user: { connect: { id: TARGET_USER_ID } },
        }),
      }),
    );

    const body = await response.json();
    expect(body.data.userId).toBe(TARGET_USER_ID);
  });

  it("returns 409 when idempotency key is reused with a different userId", async () => {
    const tx: TransactionMock = {
      coworkerUsage: {
        findUnique: vi
          .fn()
          .mockResolvedValue(createUsage({ userId: "user_original" })),
        create: vi.fn(),
      },
      transaction: {
        create: vi.fn(),
      },
    };

    mockTransaction(tx);

    const app = createApp();

    const response = await app.request("http://localhost/me/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "usage_456",
        credits: 2.5,
        userId: TARGET_USER_ID,
      }),
    });

    expect(response.status).toBe(409);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.coworkerUsage.create).not.toHaveBeenCalled();
  });
});
