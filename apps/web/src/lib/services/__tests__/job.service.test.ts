import { InputType } from "@sokosumi/masumi/types";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getBalanceMock = vi.fn();
const createDemoJobMock = vi.fn();
const createJobMock = vi.fn();
const createJobPurchaseMock = vi.fn();
const findWorkspaceForContextMock = vi.fn();
const publishJobStatusDataMock = vi.fn();
const startFreeAgentJobMock = vi.fn();
const startPaidAgentJobMock = vi.fn();
const generateJobNameMock = vi.fn();
const createPurchaseMock = vi.fn();
const getAvailableAgentByIdMock = vi.fn();
const getAgentCreditsPriceMock = vi.fn();
const getActiveOrganizationIdMock = vi.fn();
const enqueueFromMarkdownMock = vi.fn();
const trackMock = vi.fn();
const prismaTransactionMock = vi.fn();
const moveJobToWorkspaceCoreMock = vi.fn();
const getLatestJobByAgentIdUserIdAndWorkspaceMock = vi.fn();
const getSessionMock = vi.fn();
const getJobStatusDataMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  withScope: async (
    callback: (scope: {
      setTag: typeof vi.fn;
      setContext: typeof vi.fn;
    }) => unknown,
  ) =>
    await callback({
      setTag: vi.fn(),
      setContext: vi.fn(),
    }),
}));

vi.mock("@vercel/analytics/server", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("uuid", () => ({
  v4: () => "12345678-1234-4234-9234-1234567890ab",
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    getBalance: (...args: unknown[]) => getBalanceMock(...args),
  },
  jobEventRepository: {},
  jobInputRepository: {},
  jobPurchaseRepository: {
    createJobPurchase: (...args: unknown[]) => createJobPurchaseMock(...args),
  },
  jobRepository: {
    createDemoJob: (...args: unknown[]) => createDemoJobMock(...args),
    createJob: (...args: unknown[]) => createJobMock(...args),
    getLatestJobByAgentIdUserIdAndWorkspace: (...args: unknown[]) =>
      getLatestJobByAgentIdUserIdAndWorkspaceMock(...args),
  },
  workspaceRepository: {
    findWorkspaceForContext: (...args: unknown[]) =>
      findWorkspaceForContextMock(...args),
  },
}));

vi.mock("@/lib/ably/publish", () => ({
  default: (...args: unknown[]) => publishJobStatusDataMock(...args),
}));

vi.mock("@/lib/clients", () => ({
  agentClient: {
    startFreeAgentJob: (...args: unknown[]) => startFreeAgentJobMock(...args),
    startPaidAgentJob: (...args: unknown[]) => startPaidAgentJobMock(...args),
  },
  openrouterClient: {
    generateJobName: (...args: unknown[]) => generateJobNameMock(...args),
  },
  paymentClient: {
    createPurchase: (...args: unknown[]) => createPurchaseMock(...args),
  },
}));

vi.mock("@/lib/clients/agent.client", () => ({
  agentClient: {
    startFreeAgentJob: (...args: unknown[]) => startFreeAgentJobMock(...args),
    startPaidAgentJob: (...args: unknown[]) => startPaidAgentJobMock(...args),
  },
}));

vi.mock("@/lib/clients/openrouter.client", () => ({
  openrouterClient: {
    generateJobName: (...args: unknown[]) => generateJobNameMock(...args),
  },
}));

vi.mock("@/lib/clients/masumi-payment.client", () => ({
  paymentClient: {
    createPurchase: (...args: unknown[]) => createPurchaseMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    moveJobToWorkspace: (...args: unknown[]) =>
      moveJobToWorkspaceCoreMock(...args),
  },
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("@/lib/helpers/job", () => ({
  getJobStatusData: (...args: unknown[]) => getJobStatusDataMock(...args),
}));

vi.mock("@/lib/utils/job-transformers", () => ({
  transformPurchaseToJobUpdate: vi.fn().mockReturnValue({
    externalId: "purchase_1",
    onChainStatus: null,
    onChainTransactionHash: null,
    onChainTransactionStatus: null,
    resultHash: null,
    nextAction: "NONE",
    nextActionErrorType: null,
    nextActionErrorNote: null,
    errorNote: null,
    errorNoteKey: null,
  }),
}));

vi.mock("../agent.service", () => ({
  agentService: {
    getAvailableAgentById: (...args: unknown[]) =>
      getAvailableAgentByIdMock(...args),
    getAgentCreditsPrice: (...args: unknown[]) =>
      getAgentCreditsPriceMock(...args),
  },
}));

vi.mock("../source-import.service", () => ({
  sourceImportService: {
    enqueueFromMarkdown: (...args: unknown[]) =>
      enqueueFromMarkdownMock(...args),
  },
}));

vi.mock("../user.service", () => ({
  userService: {
    getActiveOrganizationId: (...args: unknown[]) =>
      getActiveOrganizationIdMock(...args),
  },
}));

vi.mock("@/lib/services/agent.service", () => ({
  agentService: {
    getAvailableAgentById: (...args: unknown[]) =>
      getAvailableAgentByIdMock(...args),
    getAgentCreditsPrice: (...args: unknown[]) =>
      getAgentCreditsPriceMock(...args),
  },
}));

vi.mock("@/lib/services/source-import.service", () => ({
  sourceImportService: {
    enqueueFromMarkdown: (...args: unknown[]) =>
      enqueueFromMarkdownMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getActiveOrganizationId: (...args: unknown[]) =>
      getActiveOrganizationIdMock(...args),
  },
}));

function buildFreeAgent() {
  return {
    id: "agent_123",
    name: "Free Agent",
    description: "desc",
    blockchainIdentifier: "agent-chain",
    pricing: {
      pricingType: "FREE",
    },
  };
}

function buildPaidAgent() {
  return {
    id: "agent_123",
    name: "Paid Agent",
    description: "desc",
    blockchainIdentifier: "agent-chain",
    pricing: {
      pricingType: "FIXED",
    },
  };
}

function buildStartInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user_123",
    organizationId: "org_123",
    agentId: "agent_123",
    inputData: {
      prompt: "hello",
    },
    inputSchema: {
      input_data: [
        {
          id: "prompt",
          type: InputType.STRING,
          name: "Prompt",
        },
      ],
    },
    maxAcceptedCents: BigInt(10),
    ...overrides,
  } as never;
}

describe("job.service workspace persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_123",
      },
      session: {
        activeOrganizationId: "org_123",
      },
    });
    generateJobNameMock.mockResolvedValue("Generated Job");
    publishJobStatusDataMock.mockResolvedValue(undefined);
    enqueueFromMarkdownMock.mockResolvedValue(undefined);
    getBalanceMock.mockResolvedValue(BigInt(1000));
    createJobPurchaseMock.mockResolvedValue(undefined);
    trackMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          tx: "transaction",
        });
      },
    );
  });

  it("persists workspaceId for demo jobs in the personal workspace", async () => {
    getActiveOrganizationIdMock.mockResolvedValue(null);
    getAvailableAgentByIdMock.mockResolvedValue(buildFreeAgent());
    createDemoJobMock.mockResolvedValue({
      id: "job_demo",
      events: [],
    });

    const { jobService } = await import("../job.service");

    await jobService.startDemoJob(buildStartInput({ organizationId: null }), {
      result: "demo result",
    } as never);

    expect(findWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      null,
      expect.any(Object),
    );
    expect(createDemoJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        organizationId: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      }),
      expect.any(Object),
    );
  });

  it("persists workspaceId for free jobs", async () => {
    getAvailableAgentByIdMock.mockResolvedValue(buildFreeAgent());
    startFreeAgentJobMock.mockResolvedValue(ok({ id: "agent_job_1" }));
    createJobMock.mockResolvedValue({
      id: "job_free",
    });

    const { jobService } = await import("../job.service");

    await jobService.startJob(buildStartInput());

    expect(findWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      expect.any(Object),
    );
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "FREE",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      }),
      expect.any(Object),
    );
  });

  it("persists workspaceId for paid jobs inside the transaction", async () => {
    const paidAgent = buildPaidAgent();
    getAvailableAgentByIdMock.mockResolvedValue(paidAgent);
    getAgentCreditsPriceMock.mockResolvedValue({
      ...paidAgent,
      creditsPrice: {
        cents: BigInt(5),
      },
    });
    startPaidAgentJobMock.mockResolvedValue(
      ok({
        id: "agent_job_1",
        input_hash: "input_hash",
        payByTime: "2026-04-02T10:00:00.000Z",
        externalDisputeUnlockTime: "2026-04-02T11:00:00.000Z",
        submitResultTime: "2026-04-02T12:00:00.000Z",
        unlockTime: "2026-04-02T13:00:00.000Z",
        blockchainIdentifier: "chain_job_1",
        sellerVKey: "seller_vkey",
      }),
    );
    createJobMock.mockResolvedValue({
      id: "job_paid",
    });
    createPurchaseMock.mockReturnValue({
      isOk: () => true,
      value: {
        id: "purchase_1",
      },
    });

    const { jobService } = await import("../job.service");

    await jobService.startJob(buildStartInput());

    expect(findWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      { tx: "transaction" },
    );
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "PAID",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      }),
      { tx: "transaction" },
    );
  });

  it("moves standalone jobs through the core client", async () => {
    moveJobToWorkspaceCoreMock.mockResolvedValue({
      data: {
        id: "job_123",
      },
    });

    const { jobService } = await import("../job.service");

    const result = await jobService.moveJobToWorkspace("job_123", "org_456");

    expect(moveJobToWorkspaceCoreMock).toHaveBeenCalledWith("job_123", {
      organizationId: "org_456",
    });
    expect(result).toEqual({
      id: "job_123",
    });
  });

  it("resolves the active workspace before loading recent job statuses", async () => {
    getLatestJobByAgentIdUserIdAndWorkspaceMock.mockResolvedValue({
      id: "job_123",
    });
    getJobStatusDataMock.mockReturnValue({
      id: "job_123",
      status: "processing",
    });

    const { jobService } = await import("../job.service");

    const result = await jobService.getJobStatusesDataForAgents(["agent_123"]);

    expect(findWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      expect.any(Object),
    );
    expect(getLatestJobByAgentIdUserIdAndWorkspaceMock).toHaveBeenCalledWith(
      "agent_123",
      "user_123",
      "11111111-1111-7111-8111-111111111111",
      expect.any(Object),
    );
    expect(result).toEqual([
      {
        id: "job_123",
        status: "processing",
      },
    ]);
  });
});
