import { AgentJobStatus, JobType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoworkerAuthorizedTaskWhere } from "@/helpers/vendor-siblings";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";

import mountGetJobById from "./get";

const {
  authContextState,
  jobFindFirstMock,
  coworkerFindFirstMock,
  taskFindFirstMock,
  memberFindUniqueMock,
  setActiveOrganizationMock,
  getSessionMock,
  observedOrganizationIds,
} = vi.hoisted(() => ({
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
  jobFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  setActiveOrganizationMock: vi.fn(),
  getSessionMock: vi.fn(),
  observedOrganizationIds: { current: [] as (string | null)[] },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      setActiveOrganization: setActiveOrganizationMock,
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/middleware/auth", () => ({
  setAuthContext: (
    c: { set: (key: string, value: unknown) => void },
    context: { isAuthenticated: boolean; authContext: unknown },
  ) => {
    c.set("isAuthenticated", context.isAuthenticated);
    c.set("authContext", context.authContext);
  },
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
  isSokoBotAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "sokoBot",
  requireCoworkerAuthContext: (authContext: { actor: string }) => {
    if (authContext.actor !== "coworker") {
      throw new Error("mock requireCoworkerAuthContext: not a coworker");
    }
    return authContext;
  },
}));

const ORGANIZATION_WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PERSONAL_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";

// Mirrors the real resolution: the workspace follows the organization on the
// auth context, so a request stripped of its organization reads the personal
// workspace instead of the organization one.
vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  return {
    ...actual,
    workspaceMiddleware:
      () =>
      async (
        c: {
          set: (key: string, value: unknown) => void;
          var: { authContext?: { organizationId?: string | null } };
        },
        next: () => Promise<unknown>,
      ) => {
        const organizationId = c.var.authContext?.organizationId ?? null;
        // Record what the route actually saw, so a test can assert the
        // organization was stripped rather than trust this branch.
        observedOrganizationIds.current.push(organizationId);
        c.set(
          "workspaceContext",
          organizationId
            ? {
                workspaceId: ORGANIZATION_WORKSPACE_ID,
                userId: null,
                organizationId,
              }
            : {
                workspaceId: PERSONAL_WORKSPACE_ID,
                userId: "user_123",
                organizationId: null,
              },
        );
        return await next();
      },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    // organizationContextMiddleware verifies membership on every request.
    member: {
      findUnique: memberFindUniqueMock,
    },
    job: {
      findFirst: jobFindFirstMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountGetJobById(app);
  return app;
}

function createJob(
  overrides: Partial<{
    ownerId: string;
    organizationId: string | null;
    owner: {
      id: string;
      name: string;
      image: string | null;
    };
    /** @deprecated Use ownerId in overrides. */
    userId?: string;
    /** @deprecated Use owner in overrides. */
    user?: {
      id: string;
      name: string;
      image: string | null;
    };
  }> = {},
) {
  const ownerId = overrides.ownerId ?? overrides.userId ?? "user_123";
  const owner = overrides.owner ??
    overrides.user ?? {
      id: ownerId,
      name: "Ada Lovelace",
      image: null,
    };

  return {
    id: "job_123",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: new Date("2026-03-26T10:10:00.000Z"),
    agentId: "agent_123",
    ownerId,
    owner,
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
    agent: {
      id: "agent_123",
      name: "Research Agent",
      icon: null,
      image: null,
      legalPrivacyPolicy: null,
      legalTerms: null,
      legalDpa: null,
      legalOther: null,
      metadataOverride: null,
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
    jobFindFirstMock.mockResolvedValue(createJob());
    coworkerFindFirstMock.mockReset();
    taskFindFirstMock.mockReset();
    memberFindUniqueMock.mockResolvedValue({ id: "member_123" });
    setActiveOrganizationMock.mockResolvedValue({
      headers: new Headers(),
      response: null,
    });
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org_123" },
      user: { id: "user_123" },
    });
    observedOrganizationIds.current = [];
  });

  it("reads the personal workspace when the organization membership was removed", async () => {
    // Production jobs router also sets requireOrganizationProductSeat.
    // This harness does not, so membership is the only control here.
    memberFindUniqueMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/job_123");

    expect(memberFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: "user_123",
          organizationId: "org_123",
        },
      },
      select: { id: true },
    });
    expect(setActiveOrganizationMock).toHaveBeenCalledWith({
      body: { organizationId: null },
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    expect(observedOrganizationIds.current).toEqual([null]);
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: PERSONAL_WORKSPACE_ID,
      },
      include: expect.any(Object),
    });
    expect(response.status).toBe(200);
  });

  it("returns a rich job details payload", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: ORGANIZATION_WORKSPACE_ID,
      },
      include: expect.any(Object),
    });
    expect(body.data.agentId).toBe("agent_123");
    expect(body.data.result).toBe("# Result");
    expect(body.data.credits).toBe(0.0005);
    expect(body.data.onChainTransactionHash).toBe("0x123abc");
    expect(body.data.onChainStatus).toBeNull();
    expect(body.data.ownerId).toBe("user_123");
    expect(body.data.userId).toBe("user_123");
    expect(body.data.organizationId).toBe("org_123");
    expect(body.data.owner.name).toBe("Ada Lovelace");
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
        ownerId: "user_123",
        owner: {
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
          workspaceId: ORGANIZATION_WORKSPACE_ID,
        },
      }),
    );
    expect(body.data).toMatchObject({
      ownerId: "user_123",
      owner: {
        id: "user_123",
        name: "Ada Lovelace",
      },
      // Deprecated aliases — keep until clients migrate.
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
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });
    taskFindFirstMock.mockResolvedValue({
      id: "tsk_123",
      coworkerId: "cow_123",
      status: TaskStatus.READY,
      coworker: { vendorId: TEST_VENDOR_ID },
    });
    jobFindFirstMock.mockResolvedValue({ ...createJob(), taskId: "tsk_123" });

    const app = createApp();
    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: buildCoworkerAuthorizedTaskWhere({
        taskId: "tsk_123",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
        workspaceId: ORGANIZATION_WORKSPACE_ID,
      }),
    });
  });

  it("allows a delegated coworker to read a job on a same-vendor sibling task", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: "org_123" },
    };
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });
    taskFindFirstMock.mockResolvedValue({
      id: "tsk_123",
      coworkerId: "cow_other",
      status: TaskStatus.READY,
      coworker: { vendorId: TEST_VENDOR_ID },
    });
    jobFindFirstMock.mockResolvedValue({ ...createJob(), taskId: "tsk_123" });

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
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: null,
    });
    taskFindFirstMock.mockResolvedValue(null);
    jobFindFirstMock.mockResolvedValue({ ...createJob(), taskId: "tsk_123" });

    const app = createApp();
    const response = await app.request("http://localhost/job_123");

    expect(response.status).toBe(404);
  });
});
