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
  getCardanoV2ReadySourcesMock,
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
  getCardanoV2ReadySourcesMock: vi.fn(),
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
  getCardanoV2ReadySources: getCardanoV2ReadySourcesMock,
  normalizeMasumiPaymentUnit: (unit: string) =>
    unit === "" || unit.toLowerCase() === "lovelace" ? "lovelace" : unit,
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
        address: "addr_test1_v2_contract",
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(1_000_000) }],
      },
      {
        sourceIndex: 2,
        address: "addr_test1_v2_contract",
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(2_000_000) }],
      },
    ],
  };
}

function createPaidV1AgentRecord() {
  return {
    ...createAgentRecord(),
    pricing: {
      pricingType: PricingType.FIXED,
      fixedPricing: {
        amounts: [{ unit: "lovelace", amount: BigInt(1_000_000) }],
      },
    },
    paymentType: PaymentType.WEB3_CARDANO_V1,
  };
}

const paidV1JobResponse = {
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
};

const paidV2JobResponse = {
  ...paidV1JobResponse,
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
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: "agent-chain",
        smartContractAddress: "addr_test1_v2_contract",
      },
    ]);
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
    // Price-drift guard: the purchase carries the selected V2 source's
    // amounts (source index 2) as strings.
    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      paidV2JobResponse,
      { prompt: "hello" },
      expect.any(String),
      [{ unit: "lovelace", amount: "2000000" }],
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

  it("forwards the V1 fixed pricing as the purchase price-drift guard", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV1AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV1JobResponse)),
    });

    await createAgentJobForUser(createInput());

    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      paidV1JobResponse,
      { prompt: "hello" },
      expect.any(String),
      [{ unit: "lovelace", amount: "1000000" }],
    );
  });

  it("rejects a V2 payment type returned by a legacy agent", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV1AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(
        ok({
          ...paidV1JobResponse,
          paymentSourceType: "Web3CardanoV2",
        }),
      ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Legacy agent job returned an invalid payment source type",
    );

    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("aggregates duplicate-unit V1 pricing rows into one purchase amount", async () => {
    agentFindFirstMock.mockResolvedValue({
      ...createPaidV1AgentRecord(),
      pricing: {
        pricingType: PricingType.FIXED,
        fixedPricing: {
          amounts: [
            { unit: "lovelace", amount: BigInt(600_000) },
            { unit: "lovelace", amount: BigInt(400_000) },
          ],
        },
      },
    });
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV1JobResponse)),
    });

    await createAgentJobForUser(createInput());

    // The payment node compares Amounts as per-unit sums, so duplicate-unit
    // pricing rows must arrive as a single summed entry.
    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      paidV1JobResponse,
      { prompt: "hello" },
      expect.any(String),
      [{ unit: "lovelace", amount: "1000000" }],
    );
  });

  it("enforces maxAcceptedCents against the selected V2 source", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    // Cheap source (index 0) stays under the cap so the cheapest-source
    // pre-check passes; the seller-selected source (index 2) exceeds it.
    calculateCentsFromMasumiAmountStringsMock.mockImplementation(
      (amounts: { unit: string; amount: string }[]) =>
        amounts.some((entry) => entry.amount === "2000000")
          ? BigInt(11)
          : BigInt(2),
    );
    const startPaidAgentJobMock = vi
      .fn()
      .mockResolvedValue(ok(paidV2JobResponse));
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Credit cost exceeds maximum accepted credits",
    );

    expect(startPaidAgentJobMock).toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("rejects maxCredits below the cheapest eligible V2 source before contacting the seller", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    // Every stored source costs more than the accepted cap of 10 cents, so
    // no seller selection could ever satisfy it.
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(11));
    const startPaidAgentJobMock = vi
      .fn()
      .mockResolvedValue(ok(paidV2JobResponse));
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    const promise = createAgentJobForUser(createInput());

    await expect(promise).rejects.toThrow(
      "Credit cost exceeds maximum accepted credits",
    );
    await expect(promise).rejects.toMatchObject({ status: 400 });

    expect(startPaidAgentJobMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("rejects a seller-selected source above the listed price without maxCredits", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    // The displayed cost is derived from agent-level pricing, whose fixture
    // amounts (1_000_000 lovelace) mirror the cheap source 0; the mocked
    // getAgentCost must agree with the cents mapping for that source.
    getAgentCostMock.mockReturnValue({ cents: BigInt(2) });
    calculateCentsFromMasumiAmountStringsMock.mockImplementation(
      (amounts: { unit: string; amount: string }[]) =>
        amounts.some((entry) => entry.amount === "2000000")
          ? BigInt(11)
          : BigInt(2),
    );
    // The seller response selects source index 2, the expensive source.
    const startPaidAgentJobMock = vi
      .fn()
      .mockResolvedValue(ok(paidV2JobResponse));
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    const promise = createAgentJobForUser(
      createInput({
        agentInput: {
          ...createInput().agentInput,
          maxAcceptedCents: undefined,
        },
      }),
    );

    await expect(promise).rejects.toThrow(
      "Selected payment source exceeds the agent's listed price",
    );
    await expect(promise).rejects.toMatchObject({ status: 422 });

    expect(startPaidAgentJobMock).toHaveBeenCalled();
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

  it("rejects a stored V2 source that the payment node cannot purchase through", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: "agent-chain",
        smartContractAddress: "addr_test1_other_contract",
      },
    ]);
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV2JobResponse)),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent job selected a payment source that is not purchase-ready",
    );

    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("rejects a V2 source with more assets than the purchase API can guard", async () => {
    const agent = createPaidV2AgentRecord();
    agent.paymentSources = agent.paymentSources.map((source) =>
      source.sourceIndex === 2
        ? {
            ...source,
            amounts: Array.from({ length: 8 }, (_, index) => ({
              unit: `unit-${index}`,
              amount: BigInt(index + 1),
            })),
          }
        : source,
    );
    agentFindFirstMock.mockResolvedValue(agent);
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV2JobResponse)),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent selected a payment source with too many assets",
    );

    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("omits the optional V1 price guard when metadata has more than seven units", async () => {
    agentFindFirstMock.mockResolvedValue({
      ...createPaidV1AgentRecord(),
      pricing: {
        pricingType: PricingType.FIXED,
        fixedPricing: {
          amounts: Array.from({ length: 8 }, (_, index) => ({
            unit: `unit-${index}`,
            amount: BigInt(index + 1),
          })),
        },
      },
    });
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(ok(paidV1JobResponse)),
    });

    await createAgentJobForUser(createInput());

    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      paidV1JobResponse,
      { prompt: "hello" },
      expect.any(String),
      undefined,
    );
  });
});
