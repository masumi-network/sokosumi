import { AgentJobStatus, JobType } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoworkerAuthorizedTaskWhere } from "@/helpers/vendor-siblings";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";

import mountGetJobById from "./get";

const { authContextState, prismaTransactionMock, jobFindFirstMock } =
  vi.hoisted(() => ({
    authContextState: {
      current: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      } as
        | {
            actor: "user";
            userId: string;
            organizationId: string | null;
            role: string;
          }
        | {
            actor: "coworker";
            coworkerId: string;
            vendorId?: string;
            context?: { userId: string; organizationId: string | null };
          }
        | null,
    },
    prismaTransactionMock: vi.fn(),
    jobFindFirstMock: vi.fn(),
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
  requireCoworkerAuthContext: (authContext: { actor: string }) => {
    if (authContext.actor !== "coworker") {
      throw new Error("mock requireCoworkerAuthContext: not a coworker");
    }
    return authContext;
  },
}));

vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  return {
    ...actual,
    requireWorkspaceContext: () => ({
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    }),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountGetJobById(app);
  return app;
}

function createJob(
  overrides: Partial<{
    userId: string;
    organizationId: string | null;
    user: {
      id: string;
      name: string;
      image: string | null;
    };
  }> = {},
) {
  return {
    id: "job_123",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: new Date("2026-03-26T10:10:00.000Z"),
    agentId: "agent_123",
    userId: overrides.userId ?? "user_123",
    organizationId: overrides.organizationId ?? "org_123",
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
    user: overrides.user ?? {
      id: overrides.userId ?? "user_123",
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
    workspaceId: "11111111-1111-7111-8111-111111111111",
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
      role: "user",
    };
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          job: {
            findFirst: jobFindFirstMock,
          },
        }),
    );
    jobFindFirstMock.mockResolvedValue(createJob());
  });

  it("returns a rich job details payload", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
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

  it("returns full job details to a same-workspace collaborator", async () => {
    authContextState.current = {
      actor: "user",
      userId: "user_456",
      organizationId: "org_123",
      role: "user",
    };
    jobFindFirstMock.mockResolvedValue(
      createJob({
        userId: "user_123",
        user: {
          id: "user_123",
          name: "Ada Lovelace",
          image: null,
        },
      }),
    );

    const app = createApp();

    const response = await app.request("http://localhost/job_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "job_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
    expect(body.data).toMatchObject({
      userId: "user_123",
      result: "# Result",
      input: '{"prompt":"hello"}',
      agentJobId: "agent_job_123",
      user: {
        id: "user_123",
        name: "Ada Lovelace",
      },
    });
    expect(body.data.events).toHaveLength(2);
  });

  it("returns 404 when the job does not exist", async () => {
    jobFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(404);
  });

  it("allows a delegated coworker to read a job assigned to its task", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: "org_123" },
    };
    const coworkerFindFirstMock = vi.fn().mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });
    const taskFindFirstMock = vi.fn().mockResolvedValue({
      id: "tsk_123",
      coworkerId: "cow_123",
      status: TaskStatus.READY,
      coworker: { vendorId: TEST_VENDOR_ID },
    });
    jobFindFirstMock.mockResolvedValue({ ...createJob(), taskId: "tsk_123" });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          coworker: { findFirst: coworkerFindFirstMock },
          job: { findFirst: jobFindFirstMock },
          task: { findFirst: taskFindFirstMock },
        }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_123",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      }),
      select: { id: true },
    });
  });

  it("allows a delegated coworker to read a job on a same-vendor sibling task", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: "org_123" },
    };
    const coworkerFindFirstMock = vi.fn().mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });
    const taskFindFirstMock = vi.fn().mockResolvedValue({
      id: "tsk_123",
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: TEST_VENDOR_ID },
    });
    jobFindFirstMock.mockResolvedValue({ ...createJob(), taskId: "tsk_123" });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          coworker: { findFirst: coworkerFindFirstMock },
          job: { findFirst: jobFindFirstMock },
          task: { findFirst: taskFindFirstMock },
        }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(200);
  });

  it("rejects a delegated coworker reading a cross-vendor sibling job", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: "org_123" },
    };
    const coworkerFindFirstMock = vi.fn().mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });
    const taskFindFirstMock = vi.fn().mockResolvedValue(null);
    jobFindFirstMock.mockResolvedValue({ ...createJob(), taskId: "tsk_123" });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          coworker: { findFirst: coworkerFindFirstMock },
          job: { findFirst: jobFindFirstMock },
          task: { findFirst: taskFindFirstMock },
        }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(403);
  });
});
