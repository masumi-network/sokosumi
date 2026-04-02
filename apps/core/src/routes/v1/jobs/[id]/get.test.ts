import { AgentJobStatus, JobType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetJobById from "./get";

const { authContextState, prismaTransactionMock, jobFindUniqueMock } =
  vi.hoisted(() => ({
    authContextState: {
      current: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      } as {
        actor: "user";
        userId: string;
        organizationId: string | null;
      } | null,
    },
    prismaTransactionMock: vi.fn(),
    jobFindUniqueMock: vi.fn(),
  }));

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
  requireUserAuthContext: (authContext: unknown) => authContext,
}));

vi.mock("@/helpers/access-control.js", () => ({
  requireJobReadAccess: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth({ includeOrganizationHeader: false });
  mountGetJobById(app);
  return app;
}

function createJob() {
  return {
    id: "job_123",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: new Date("2026-03-26T10:10:00.000Z"),
    agentId: "agent_123",
    userId: "user_123",
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
    blockchainIdentifier: null,
    sellerVkey: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    user: {
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
      nextAction: null,
    },
    purchaseId: "purchase_123",
    jobScheduleId: null,
    jobSchedule: null,
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
      {
        id: "event_initiated",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
        status: AgentJobStatus.INITIATED,
        inputSchema: '{"input_data":[]}',
        input: {
          id: "input_123",
          input: '{"prompt":"hello"}',
          inputHash: null,
          signature: null,
        },
        result: null,
        blobs: [],
        links: [],
      },
    ],
  };
}

describe("GET /jobs/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    };
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          job: {
            findUnique: jobFindUniqueMock,
          },
        }),
    );
    jobFindUniqueMock.mockResolvedValue(createJob());
  });

  it("returns a rich job details payload", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "job_123" },
      include: expect.any(Object),
    });
    expect(body.data.agentId).toBe("agent_123");
    expect(body.data.result).toBe("# Result");
    expect(body.data.credits).toBe(0.0005);
    expect(body.data.onChainTransactionHash).toBe("0x123abc");
    expect(body.data.onChainStatus).toBeNull();
    expect(body.data.userId).toBe("user_123");
    expect(body.data.organizationId).toBe("org_123");
    expect(body.data.user.name).toBe("Ada Lovelace");
    expect(body.data.organization).toEqual({
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
    });
    expect(body.data.agent.id).toBe("agent_123");
    expect(body.data.events).toHaveLength(2);
    expect(body.data).not.toHaveProperty("transaction");
    expect(body.data).not.toHaveProperty("purchase");
  });

  it("returns 404 when the job does not exist", async () => {
    jobFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(404);
  });
});
