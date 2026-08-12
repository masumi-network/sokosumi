import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTransactions from "./get";

const { transactionCountMock, transactionFindManyMock } = vi.hoisted(() => ({
  transactionCountMock: vi.fn(),
  transactionFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    transaction: {
      count: transactionCountMock,
      findMany: transactionFindManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const PERSONAL_WORKSPACE_CONTEXT = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext: WorkspaceVariables["workspaceContext"] = PERSONAL_WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });

  mountGetTransactions(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createTransactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "txn_123",
    createdAt: new Date("2026-01-15T10:30:00.000Z"),
    amount: -50_000_000_000n,
    userId: "user_123",
    organizationId: null,
    job: null,
    refundedJob: null,
    taskPaymentClaim: null,
    coworkerUsage: null,
    orchestratorUsage: null,
    sourceCreditBucket: null,
    ...overrides,
  };
}

describe("GET /transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionFindManyMock.mockResolvedValue([]);
    transactionCountMock.mockResolvedValue(0);
  });

  it("scopes to the personal workspace's owning user by default", async () => {
    const row = createTransactionRow({
      job: { id: "job_1", agentId: "agent_1" },
    });
    transactionFindManyMock.mockResolvedValue([row]);
    transactionCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(transactionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_123", organizationId: null },
        take: LIMITS.DEFAULT_PAGINATION_LIMIT + 1,
      }),
    );

    const body = (await response.json()) as {
      data: Array<{
        agentId: string | null;
        credits: number;
        jobId: string | null;
        source: string;
      }>;
    };
    expect(body.data).toEqual([
      {
        id: "txn_123",
        createdAt: "2026-01-15T10:30:00.000Z",
        credits: -5,
        source: "job_purchase",
        jobId: "job_1",
        agentId: "agent_1",
      },
    ]);
  });

  it("scopes to the organization for an organization workspace, pooling all members", async () => {
    const app = createApp(USER_AUTH_CONTEXT, {
      workspaceId: "22222222-2222-7222-8222-222222222222",
      userId: null,
      organizationId: "org_123",
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(transactionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_123" },
      }),
    );
  });

  it("rejects a coworker actor without user/orchestrator context", async () => {
    const app = createApp(
      {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: "vendor_123",
      } as AuthenticationContext,
      null,
    );

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(transactionFindManyMock).not.toHaveBeenCalled();
  });
});
