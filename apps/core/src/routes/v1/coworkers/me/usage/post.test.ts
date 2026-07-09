import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostCoworkerMeUsage from "./post";

const {
  prepareConsumptionMock,
  prismaTransactionMock,
  requireCoworkerCapabilityMock,
} = vi.hoisted(() => ({
  prepareConsumptionMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    prepareConsumption: prepareConsumptionMock,
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

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
  member: {
    findUnique: ReturnType<typeof vi.fn>;
  };
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
      actor: "coworker",
      coworkerId: COWORKER_ID,
      vendorId: TEST_VENDOR_ID,
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
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
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

  it("returns 400 when organizationId is missing", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/me/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "usage_missing_org",
        credits: 2.5,
        userId: TARGET_USER_ID,
      }),
    });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("creates usage and bills the request userId", async () => {
    const tx: TransactionMock = {
      member: {
        findUnique: vi.fn().mockResolvedValue({
          userId: TARGET_USER_ID,
        }),
      },
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
        organizationId: ORGANIZATION_ID,
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

  it("returns 403 when tasks capability is unavailable", async () => {
    requireCoworkerCapabilityMock.mockRejectedValue(
      new HTTPException(403, {
        message: "Coworker is not allowed to use tasks",
      }),
    );

    const app = createApp();

    const response = await app.request("http://localhost/me/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "usage_missing_capability",
        credits: 2.5,
        userId: TARGET_USER_ID,
        organizationId: ORGANIZATION_ID,
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 409 when idempotency key is reused with a different userId", async () => {
    const tx: TransactionMock = {
      member: {
        findUnique: vi.fn().mockResolvedValue({
          userId: TARGET_USER_ID,
        }),
      },
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
        organizationId: ORGANIZATION_ID,
      }),
    });

    expect(response.status).toBe(409);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.coworkerUsage.create).not.toHaveBeenCalled();
  });

  it("returns 409 when idempotency key is reused with a different organizationId", async () => {
    const tx: TransactionMock = {
      member: {
        findUnique: vi.fn().mockResolvedValue({
          userId: TARGET_USER_ID,
        }),
      },
      coworkerUsage: {
        findUnique: vi.fn().mockResolvedValue(
          createUsage({
            userId: TARGET_USER_ID,
            organizationId: "org_original",
          }),
        ),
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
        organizationId: ORGANIZATION_ID,
      }),
    });

    expect(response.status).toBe(409);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.coworkerUsage.create).not.toHaveBeenCalled();
  });

  it("replays existing usage even when membership no longer exists", async () => {
    const tx: TransactionMock = {
      member: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      coworkerUsage: {
        findUnique: vi.fn().mockResolvedValue(
          createUsage({
            userId: TARGET_USER_ID,
            organizationId: ORGANIZATION_ID,
          }),
        ),
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
        organizationId: ORGANIZATION_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(tx.coworkerUsage.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.coworkerUsage.create).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when user is not a member of the provided organization", async () => {
    const tx: TransactionMock = {
      member: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      coworkerUsage: {
        findUnique: vi.fn(),
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
        organizationId: ORGANIZATION_ID,
      }),
    });

    expect(response.status).toBe(400);
    expect(tx.coworkerUsage.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.member.findUnique).toHaveBeenCalledTimes(1);
    expect(
      tx.coworkerUsage.findUnique.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.member.findUnique.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
