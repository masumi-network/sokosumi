import { AgentJobStatus, JobType, NextJobAction } from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostJobRefund from "./post";

const {
  authContextState,
  prismaTransactionMock,
  jobFindUniqueMock,
  updateJobPurchaseByExternalIdMock,
  requireJobCollaborationMock,
} = vi.hoisted(() => ({
  requireJobCollaborationMock: vi.fn(async () => undefined),
  authContextState: {
    current: {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    } as {
      actor: "user";
      userId: string;
      organizationId: string | null;
      role: string;
    } | null,
  },
  prismaTransactionMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  updateJobPurchaseByExternalIdMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    jobPurchaseRepository: {
      ...actual.jobPurchaseRepository,
      updateJobPurchaseByExternalId: updateJobPurchaseByExternalIdMock,
    },
  };
});

vi.mock("@/middleware/auth", () => ({
  authMiddleware: async (
    c: {
      json: (body: unknown, status: number) => unknown;
      req: { path: string; method: string };
      set: (key: string, value: unknown) => void;
    },
    next: () => Promise<unknown>,
  ) => {
    if (!authContextState.current) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Unauthorized",
          meta: {
            timestamp: new Date().toISOString(),
            requestId: "req_123",
            path: c.req.path,
            method: c.req.method,
          },
        },
        401,
      );
    }

    c.set("isAuthenticated", true);
    c.set("authContext", authContextState.current);
    return await next();
  },
  requireUserContext: (authContext: unknown) => {
    const a = authContext as {
      actor: string;
      userId: string;
      organizationId: string | null;
      role: string;
      context?: { userId: string; organizationId: string | null };
    };
    if (a.actor === "user") {
      return {
        source: "session" as const,
        actor: "user",
        userId: a.userId,
        organizationId: a.organizationId,
        role: a.role,
      };
    }
    if (a.actor === "coworker" && a.context) {
      return {
        source: "context" as const,
        userId: a.context.userId,
        organizationId: a.context.organizationId,
      };
    }
    throw new Error("mock requireUserContext: unsupported auth context");
  },
  isUserAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "user",
  isCoworkerAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "coworker",
  isOrchestratorAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "orchestrator",
}));

vi.mock("@/helpers/access-control.js", () => ({
  requireJobCollaboration: requireJobCollaborationMock,
}));

const requestRefundMock = vi.fn();

vi.mock("@/clients/masumi-payment.client.js", () => ({
  paymentClient: () => ({
    requestRefund: requestRefundMock,
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountPostJobRefund(app);
  return app;
}

function createFullJobForSecondFetch() {
  return {
    id: "job_123",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: new Date("2026-03-26T10:10:00.000Z"),
    agentId: "agent_123",
    ownerId: "user_123",
    organizationId: "org_123",
    taskId: null,
    name: "Shared Job",
    jobType: JobType.PAID,
    agentJobId: "agent_job_123",
    identifierFromPurchaser: "identifier_123",
    payByTime: null,
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    blockchainIdentifier: "purchase_bc_1",
    sellerVkey: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    owner: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    agent: {
      id: "agent_123",
      name: "Research Agent",
      overrideName: null,
      icon: null,
      image: null,
      overrideImage: null,
      legalPrivacyPolicy: null,
      overrideLegalPrivacyPolicy: null,
      legalTerms: null,
      overrideLegalTerms: null,
      legalDpa: null,
      overrideLegalDpa: null,
      legalOther: null,
      overrideLegalOther: null,
    },
    organization: {
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
      logo: null,
    },
    transaction: {
      amount: BigInt(5000000),
    },
    transactionId: "txn_123",
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    purchase: {
      onChainStatus: null,
      onChainTransactionHash: "0x123abc",
      resultHash: "result_hash_123",
      nextAction: NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
    },
    purchaseId: "purchase_123",
    events: [
      {
        id: "event_completed",
        createdAt: new Date("2026-03-26T10:10:00.000Z"),
        updatedAt: new Date("2026-03-26T10:10:00.000Z"),
        status: AgentJobStatus.COMPLETED,
        inputSchema: null,
        input: null,
        result: "# Result",
        blobs: [],
        links: [],
      },
    ],
  };
}

describe("POST /jobs/{id}/refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobFindUniqueMock.mockReset();
    requireJobCollaborationMock.mockReset();
    requireJobCollaborationMock.mockResolvedValue(undefined);
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    };
    requestRefundMock.mockResolvedValue(ok());

    let transactionPhase: "preflight" | "persist" = "preflight";
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          job: { findUnique: typeof jobFindUniqueMock };
        }) => Promise<unknown>,
      ) => {
        if (transactionPhase === "preflight") {
          jobFindUniqueMock.mockResolvedValueOnce({
            ownerId: "user_123",
            jobType: JobType.PAID,
            blockchainIdentifier: "purchase_bc_1",
            purchase: { externalId: "purchase_ext_1" },
          });
          transactionPhase = "persist";
        } else {
          jobFindUniqueMock.mockResolvedValueOnce(
            createFullJobForSecondFetch(),
          );
        }
        return await callback({
          job: {
            findUnique: jobFindUniqueMock,
          },
        });
      },
    );
  });

  it("requests refund and updates purchase nextAction", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123/refund", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestRefundMock).toHaveBeenCalledWith("purchase_bc_1");
    expect(updateJobPurchaseByExternalIdMock).toHaveBeenCalledWith(
      "purchase_ext_1",
      {
        nextAction: NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
      },
      expect.any(Object),
    );
    expect(body.data.id).toBe("job_123");
  });

  it("returns 403 when the job belongs to another user", async () => {
    requireJobCollaborationMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );

    const app = createApp();
    const response = await app.request("http://localhost/job_123/refund", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(requestRefundMock).not.toHaveBeenCalled();
    expect(updateJobPurchaseByExternalIdMock).not.toHaveBeenCalled();
  });

  it("returns 422 when the job is not paid", async () => {
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          job: { findUnique: typeof jobFindUniqueMock };
        }) => Promise<unknown>,
      ) => {
        jobFindUniqueMock.mockResolvedValue({
          jobType: JobType.FREE,
          blockchainIdentifier: null,
          purchase: null,
        });
        return await callback({
          job: { findUnique: jobFindUniqueMock },
        });
      },
    );

    const app = createApp();
    const response = await app.request("http://localhost/job_123/refund", {
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(requestRefundMock).not.toHaveBeenCalled();
    expect(updateJobPurchaseByExternalIdMock).not.toHaveBeenCalled();
  });

  it("returns 422 when payment refund fails", async () => {
    requestRefundMock.mockResolvedValueOnce(err("payment failed"));

    const app = createApp();
    const response = await app.request("http://localhost/job_123/refund", {
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(updateJobPurchaseByExternalIdMock).not.toHaveBeenCalled();
  });
});
