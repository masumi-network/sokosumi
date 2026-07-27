import { PaymentType, PricingType } from "@sokosumi/database";
import { jobSummaryInclude } from "@sokosumi/database/types/job";
import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentJobForUser } from "./job";

const {
  agentFindFirstMock,
  calculateCentsFromMasumiAmountStringsMock,
  createAgentClientMock,
  createPurchaseMock,
  creditBucketPrepareConsumptionMock,
  generateJobNameMock,
  getAgentCostMock,
  getCreditCostsOrThrowMock,
  projectFindFirstMock,
  prismaTransactionMock,
  txJobCreateMock,
} = vi.hoisted(() => ({
  agentFindFirstMock: vi.fn(),
  calculateCentsFromMasumiAmountStringsMock: vi.fn(),
  createAgentClientMock: vi.fn(),
  createPurchaseMock: vi.fn(),
  creditBucketPrepareConsumptionMock: vi.fn(),
  generateJobNameMock: vi.fn(),
  getAgentCostMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  txJobCreateMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  buildAvailableAgentWhereClause: () => ({}),
  calculateCentsFromMasumiAmountStrings:
    calculateCentsFromMasumiAmountStringsMock,
  getAgentCost: getAgentCostMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
  toMasumiAgent: (agent: {
    id: string;
    name: string;
    blockchainIdentifier: string;
    apiBaseUrl: string;
    metadataOverride?: { apiBaseUrl?: string | null } | null;
  }) => ({
    id: agent.id,
    name: agent.name,
    blockchainIdentifier: agent.blockchainIdentifier,
    apiBaseUrl: agent.apiBaseUrl,
    metadataOverride: agent.metadataOverride
      ? { apiBaseUrl: agent.metadataOverride.apiBaseUrl }
      : null,
  }),
}));

vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: createAgentClientMock,
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateJobName: generateJobNameMock,
  },
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    createPurchase: createPurchaseMock,
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: {
      findFirst: agentFindFirstMock,
    },
    project: {
      findFirst: projectFindFirstMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/user", () => ({
  getCents: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    prepareConsumption: creditBucketPrepareConsumptionMock,
  },
  jobPurchaseRepository: {
    createJobPurchase: vi.fn(),
  },
}));

function createAgentRecord() {
  return {
    id: "agent_1",
    name: "Agent One",
    description: "desc",
    apiBaseUrl: "https://agent.example.com",
    metadataOverride: null,
    blockchainIdentifier: "agent-chain",
    pricing: {
      pricingType: PricingType.FREE,
      fixedPricing: null,
    },
    paymentType: PaymentType.NONE,
    paymentSources: [],
  };
}

function createPaidV2AgentRecord() {
  return {
    ...createAgentRecord(),
    pricing: {
      pricingType: PricingType.FIXED,
      fixedPricing: {
        amounts: [{ unit: "lovelace", amount: BigInt(1_000_000) }],
      },
    },
    paymentType: PaymentType.WEB3_CARDANO_V2,
    paymentSources: [
      {
        sourceIndex: 0,
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(1_000_000) }],
      },
      {
        sourceIndex: 2,
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(2_000_000) }],
      },
    ],
  };
}

const paidV2JobResponse = {
  id: "agent_job_1",
  input_hash: "input-hash",
  identifierFromPurchaser: "buyer-reference",
  blockchainIdentifier: "purchase-chain",
  payByTime: 1_775_737_949_000,
  submitResultTime: 1_775_755_949_000,
  unlockTime: 1_775_773_949_000,
  externalDisputeUnlockTime: 1_775_784_749_000,
  agentIdentifier: "agent-chain",
  sellerVKey: "seller-vkey",
  paymentSourceType: "Web3CardanoV2" as const,
  supportedPaymentSourceIndex: 2,
};

function createInput(overrides: Record<string, unknown> = {}) {
  const inputSchema = {
    input_data: [
      {
        id: "prompt",
        type: InputType.STRING,
        name: "prompt",
      },
    ],
  } satisfies InputSchemaSchemaType;

  return {
    owner: {
      ownerId: "user_1",
      organizationId: "org_1",
      workspaceId: "11111111-1111-7111-8111-111111111111",
    },
    agentInput: {
      agentId: "agent_1",
      inputData: { prompt: "hello" },
      inputSchema,
      maxAcceptedCents: BigInt(10),
      name: "Scheduled Job",
    },
    ...overrides,
  };
}

describe("createAgentJobForUser schedule/max-cents behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCreditCostsOrThrowMock.mockResolvedValue([{ unit: "lovelace" }]);
    getAgentCostMock.mockReturnValue({ cents: BigInt(0) });
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(2));
    creditBucketPrepareConsumptionMock.mockResolvedValue([]);
    createPurchaseMock.mockResolvedValue(err("payment unavailable"));
    agentFindFirstMock.mockResolvedValue(createAgentRecord());
    projectFindFirstMock.mockResolvedValue({ id: "project_1" });
    createAgentClientMock.mockReturnValue({
      startFreeAgentJob: vi.fn().mockResolvedValue(ok({ id: "agent_job_1" })),
    });
    txJobCreateMock.mockResolvedValue({
      id: "job_1",
      agentId: "agent_1",
      ownerId: "user_1",
    });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          job: {
            create: txJobCreateMock,
          },
        });
      },
    );
  });

  it("rejects when cost exceeds maxAcceptedCents", async () => {
    getAgentCostMock.mockReturnValue({ cents: BigInt(11) });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Credit cost exceeds maximum accepted credits",
    );
  });

  it("connects jobs to a project when projectId belongs to the workspace", async () => {
    await createAgentJobForUser(
      createInput({
        agentInput: {
          ...createInput().agentInput,
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        },
      }),
    );

    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: { id: true },
    });
    expect(txJobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          project: {
            connect: {
              id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            },
          },
        }),
        include: jobSummaryInclude,
      }),
    );
  });

  it("throws not found when projectId does not belong to the workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    await expect(
      createAgentJobForUser(
        createInput({
          agentInput: {
            ...createInput().agentInput,
            projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          },
        }),
      ),
    ).rejects.toThrow("Project not found");

    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createAgentClientMock).not.toHaveBeenCalled();
  });

  it("leaves project unset when projectId is omitted", async () => {
    await createAgentJobForUser(createInput());

    const createCall = txJobCreateMock.mock.calls[0]?.[0];
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(createCall.data).not.toHaveProperty("project");
  });

  it("preserves a generated job name longer than the previous max length", async () => {
    generateJobNameMock.mockResolvedValue("x".repeat(200));

    await createAgentJobForUser(
      createInput({
        agentInput: {
          ...createInput().agentInput,
          name: undefined,
        },
      }),
    );

    expect(generateJobNameMock).toHaveBeenCalled();
    const createCall = txJobCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.name).toBe("x".repeat(200));
  });

  it("snapshots and forwards the V2 payment source selected by the agent", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV2JobResponse)),
    });

    await createAgentJobForUser(createInput());

    expect(agentFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          paymentSources: {
            where: {
              chain: "Cardano",
              network: "Preprod",
              paymentSourceType: "Web3CardanoV2",
            },
            include: {
              amounts: true,
            },
            orderBy: { sourceIndex: "asc" },
          },
        }),
      }),
    );
    expect(txJobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentBlockchainIdentifier: "agent-chain",
          agentApiBaseUrl: "https://agent.example.com",
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 2,
        }),
      }),
    );
    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      paidV2JobResponse,
      { prompt: "hello" },
      expect.any(String),
    );
    expect(calculateCentsFromMasumiAmountStringsMock).toHaveBeenCalledWith(
      [{ unit: "lovelace", amount: "2000000" }],
      [{ unit: "lovelace" }],
    );
    expect(creditBucketPrepareConsumptionMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      BigInt(2),
      expect.any(Object),
    );
  });

  it("enforces maxAcceptedCents against the selected V2 source", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(11));
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV2JobResponse)),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Credit cost exceeds maximum accepted credits",
    );

    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("rejects a V2 response that selects a different payment source", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(
        ok({
          ...paidV2JobResponse,
          supportedPaymentSourceIndex: 3,
        }),
      ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent job returned an unexpected payment source",
    );

    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });
});
