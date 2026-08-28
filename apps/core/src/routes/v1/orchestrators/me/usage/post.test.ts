import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostOrchestratorMeUsage from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
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

function createApp(
  actor: "orchestrator" | "user" = "orchestrator",
  authOverrides: {
    context?: { organizationId: string | null; userId: string };
    orchestratorId?: string;
  } = {},
) {
  const app = new OpenAPIHonoWithAuth();

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

  mountPostOrchestratorMeUsage(app);

  return app;
}

function mockTxWithOrchestrator(options?: {
  existingUsage?: UsageRecord | null;
  createUsage?: UsageRecord;
  archivedAt?: Date | null;
  orchestrator?: null;
  member?: { userId: string } | null;
}) {
  const findUnique = vi.fn().mockResolvedValue(
    options?.orchestrator === null
      ? null
      : {
          id: ORCHESTRATOR_ID,
          userId: TARGET_USER_ID,
          archivedAt: options?.archivedAt ?? null,
        },
  );
  const usageCreate = vi
    .fn()
    .mockResolvedValue(options?.createUsage ?? createUsage());
  const usageFindUnique = vi
    .fn()
    .mockResolvedValue(options?.existingUsage ?? null);
  const memberFindUnique = vi
    .fn()
    .mockResolvedValue(
      options?.member === undefined
        ? { userId: TARGET_USER_ID }
        : options.member,
    );

  serializableTransactionMock.mockImplementation(async (callback) => {
    const tx = {
      orchestrator: {
        findUnique,
      },
      orchestratorUsage: {
        findUnique: usageFindUnique,
        create: usageCreate,
      },
      member: {
        findUnique: memberFindUnique,
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn_123" }),
      },
    };
    return callback(tx);
  });

  return { findUnique, memberFindUnique, usageCreate, usageFindUnique };
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

    expect(response.status).toBe(422);
    expect(serializableTransactionMock).not.toHaveBeenCalled();
  });

  it("creates usage and bills the request userId using that user's orchestrator", async () => {
    const { findUnique, usageCreate } = mockTxWithOrchestrator();

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

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: TARGET_USER_ID },
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

  it("returns 404 when the user has no orchestrator row", async () => {
    mockTxWithOrchestrator({ orchestrator: null });

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

  it("returns 404 for new usage when the orchestrator is archived", async () => {
    const { usageCreate } = mockTxWithOrchestrator({
      archivedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: "usage_new",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(404);
    expect(usageCreate).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("replays existing usage after archive (idempotent retry)", async () => {
    const existing = createUsage();
    const { usageCreate } = mockTxWithOrchestrator({
      archivedAt: new Date("2026-07-01T00:00:00.000Z"),
      existingUsage: existing,
    });

    const app = createApp();
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: existing.idempotencyKey,
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(existing.id);
    expect(body.data.credits).toBe(2.5);
    expect(usageCreate).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when X-Context organization is set but the user is not a member", async () => {
    const { usageCreate } = mockTxWithOrchestrator({ member: null });

    const app = createApp("orchestrator", {
      context: { organizationId: "org_123", userId: TARGET_USER_ID },
    });
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: "usage_456",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(400);
    expect(usageCreate).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the member has no assigned organization seat", async () => {
    vi.mocked(requireAssignedOrganizationSeat).mockRejectedValueOnce(
      new HTTPException(403, {
        message: "An assigned seat is required to use this organization",
        cause: { kind: CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED },
      }),
    );
    const { usageCreate } = mockTxWithOrchestrator();

    const app = createApp("orchestrator", {
      context: { organizationId: "org_123", userId: TARGET_USER_ID },
    });
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: "usage_unseated",
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(403);
    expect(usageCreate).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the idempotency key is reused with a different organization id", async () => {
    const existing = createUsage({ organizationId: "org_original" });
    const { usageCreate } = mockTxWithOrchestrator({ existingUsage: existing });

    const app = createApp("orchestrator", {
      context: { organizationId: "org_123", userId: TARGET_USER_ID },
    });
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: existing.idempotencyKey,
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("different organization id");
    expect(usageCreate).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("replays existing usage for the same organization id", async () => {
    const existing = createUsage({ organizationId: "org_123" });
    const { usageCreate } = mockTxWithOrchestrator({ existingUsage: existing });

    const app = createApp("orchestrator", {
      context: { organizationId: "org_123", userId: TARGET_USER_ID },
    });
    const response = await app.request("/me/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TARGET_USER_ID,
        idempotencyKey: existing.idempotencyKey,
        credits: 2.5,
      }),
    });

    expect(response.status).toBe(200);
    expect(usageCreate).not.toHaveBeenCalled();
    expect(prepareConsumptionMock).not.toHaveBeenCalled();
  });

  it("bills the organization pool when X-Context organization is set and the user is a member", async () => {
    mockTxWithOrchestrator();

    const app = createApp("orchestrator", {
      context: { organizationId: "org_123", userId: TARGET_USER_ID },
    });
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
    expect(prepareConsumptionMock).toHaveBeenCalledWith(
      TARGET_USER_ID,
      "org_123",
      expect.any(BigInt),
      expect.anything(),
    );
  });
});
