import { PaymentType, PricingType } from "@sokosumi/database";
import { jobListSummaryInclude } from "@sokosumi/database/types/job";
import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { HTTPException } from "hono/http-exception";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";

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
  getCentsMock,
  projectFindFirstMock,
  prismaTransactionMock,
  sentryCaptureExceptionMock,
  txAgentUpdateMock,
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
  getCentsMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  sentryCaptureExceptionMock: vi.fn(),
  txAgentUpdateMock: vi.fn(),
  txJobCreateMock: vi.fn(),
}));

// Partial mock: the readiness matcher and unit normalizer come from the REAL
// module. A hand-written copy here would mean every V2 readiness assertion in
// this file validated the test's own logic instead of production's.
vi.mock("@/helpers/agent-cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/agent-cost")>()),
  calculateCentsFromMasumiAmountStrings:
    calculateCentsFromMasumiAmountStringsMock,
  getAgentCost: getAgentCostMock,
}));

vi.mock("@/helpers/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/agent")>()),
  buildAvailableAgentWhereClause: () => ({}),
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
  getCardanoV2ReadySources: getCardanoV2ReadySourcesMock,
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

vi.mock("@sokosumi/masumi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/masumi")>()),
  createAgentClient: createAgentClientMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: sentryCaptureExceptionMock,
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

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/user", () => ({
  getCents: getCentsMock,
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

/**
 * A conforming seller echoes back the purchaser nonce it was given, so mocks
 * must too — Core rejects a mismatched echo before creating the purchase.
 */
function sellerResponding(response: Record<string, unknown>) {
  return vi
    .fn()
    .mockImplementation(
      async (_agent: unknown, identifierFromPurchaser: string) =>
        ok({ ...response, identifierFromPurchaser }),
    );
}

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
    getCentsMock.mockResolvedValue(BigInt(1_000_000));
    getAgentCostMock.mockReturnValue({ cents: BigInt(0) });
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: "agent-chain",
        smartContractAddress: "addr_test1_v2_contract",
      },
    ]);
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(2));
    creditBucketPrepareConsumptionMock.mockResolvedValue([]);
    // A PurchaseFailure shape, not a bare string: registerJobPurchase retries
    // an `ambiguous` verdict, and these tests assert the payload the node
    // receives rather than the retry policy, which has its own tests.
    createPurchaseMock.mockResolvedValue(
      err({ kind: "permanent", message: "payment unavailable" }),
    );
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
    txAgentUpdateMock.mockResolvedValue({ id: "agent_1", jobCount: 1 });
    // The hire uses BOTH forms: the batch form to read the agent and its
    // pricing in one snapshot, then the interactive form to create the job.
    prismaTransactionMock.mockImplementation(async (operations: unknown) => {
      if (Array.isArray(operations)) {
        return await Promise.all(operations);
      }
      return await (operations as (tx: unknown) => unknown)({
        job: {
          create: txJobCreateMock,
        },
        agent: {
          update: txAgentUpdateMock,
        },
      });
    });
  });

  it("rejects when cost exceeds maxAcceptedCents", async () => {
    getAgentCostMock.mockReturnValue({ cents: BigInt(11) });
    const beforeSellerStart = vi.fn();

    await expect(
      createAgentJobForUser(createInput({ beforeSellerStart })),
    ).rejects.toThrow("Credit cost exceeds maximum accepted credits");
    expect(beforeSellerStart).not.toHaveBeenCalled();
  });

  it("crosses the retry fence immediately before seller execution", async () => {
    const callOrder: string[] = [];
    const startFreeAgentJob = vi.fn(async () => {
      callOrder.push("seller");
      return ok({ id: "agent_job_1" });
    });
    createAgentClientMock.mockReturnValue({ startFreeAgentJob });

    await createAgentJobForUser(
      createInput({
        beforeSellerStart: vi.fn(async () => {
          callOrder.push("fence");
        }),
      }),
    );

    expect(callOrder).toEqual(["fence", "seller"]);
  });

  it("runs the local Job callback inside its creation transaction", async () => {
    let insideLocalTransaction = false;
    const transactionClient = {
      job: { create: txJobCreateMock },
      agent: { update: txAgentUpdateMock },
    };
    prismaTransactionMock.mockImplementation(async (operation: unknown) => {
      if (Array.isArray(operation)) {
        return await Promise.all(operation);
      }
      insideLocalTransaction = true;
      try {
        return await (
          operation as (tx: typeof transactionClient) => Promise<unknown>
        )(transactionClient);
      } finally {
        insideLocalTransaction = false;
      }
    });
    const afterLocalJobCreate = vi.fn(
      async (job: { id: string }, tx: typeof transactionClient) => {
        expect(insideLocalTransaction).toBe(true);
        expect(job.id).toBe("job_1");
        expect(tx).toBe(transactionClient);
        expect(txJobCreateMock).toHaveBeenCalledOnce();
      },
    );

    await createAgentJobForUser(createInput({ afterLocalJobCreate }));

    expect(afterLocalJobCreate).toHaveBeenCalledOnce();
    expect(insideLocalTransaction).toBe(false);
  });

  it("rejects insufficient balance before paid seller dispatch", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV1AgentRecord());
    getAgentCostMock.mockReturnValue({ cents: BigInt(5) });
    getCentsMock.mockResolvedValue(BigInt(4));
    const startPaidAgentJob = sellerResponding(paidV1JobResponse);
    createAgentClientMock.mockReturnValue({ startPaidAgentJob });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Insufficient balance",
    );

    expect(startPaidAgentJob).not.toHaveBeenCalled();
  });

  it("resolves generated Job name before seller dispatch", async () => {
    const startFreeAgentJob = vi
      .fn()
      .mockResolvedValue(ok({ id: "agent_job_1" }));
    createAgentClientMock.mockReturnValue({ startFreeAgentJob });
    generateJobNameMock.mockRejectedValue(new Error("name model unavailable"));

    await expect(
      createAgentJobForUser(
        createInput({
          agentInput: { ...createInput().agentInput, name: undefined },
        }),
      ),
    ).rejects.toThrow("name model unavailable");

    expect(startFreeAgentJob).not.toHaveBeenCalled();
  });

  it("does not call start_job when the owner has no assigned organization seat", async () => {
    const startFreeAgentJobMock = vi
      .fn()
      .mockResolvedValue(ok({ id: "agent_job_1" }));
    createAgentClientMock.mockReturnValue({
      startFreeAgentJob: startFreeAgentJobMock,
    });
    vi.mocked(requireAssignedOrganizationSeat).mockRejectedValueOnce(
      new HTTPException(403, {
        message: "An assigned seat is required to use this organization",
      }),
    );

    await expect(createAgentJobForUser(createInput())).rejects.toMatchObject({
      status: 403,
    });
    expect(startFreeAgentJobMock).not.toHaveBeenCalled();
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
        include: jobListSummaryInclude,
      }),
    );
    expect(txAgentUpdateMock).toHaveBeenCalledWith({
      where: { id: "agent_1" },
      data: { jobCount: { increment: 1 } },
    });
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
      startPaidAgentJob: sellerResponding(paidV2JobResponse),
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
          purchaseAmounts: [{ unit: "lovelace", amount: "2000000" }],
        }),
      }),
    );
    // Price-drift guard: the purchase carries the selected V2 source's
    // amounts (source index 2) as strings.
    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      { ...paidV2JobResponse, identifierFromPurchaser: expect.any(String) },
      { prompt: "hello" },
      expect.any(String),
      // ADA goes to the node as an empty unit — its /purchase contract spells
      // lovelace that way. Internally the canonical unit stays "lovelace".
      [{ unit: "", amount: "2000000" }],
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
      startPaidAgentJob: sellerResponding(paidV1JobResponse),
    });

    await createAgentJobForUser(createInput());

    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      {
        ...paidV1JobResponse,
        identifierFromPurchaser: expect.any(String),
        // The V1 branch records the rail explicitly and drops any stray V2
        // index the seller echoed.
        paymentSourceType: "Web3CardanoV1",
        supportedPaymentSourceIndex: undefined,
      },
      { prompt: "hello" },
      expect.any(String),
      // ADA leaves as an empty unit per the node's /purchase contract.
      [{ unit: "", amount: "1000000" }],
    );
    expect(txJobCreateMock.mock.calls[0]?.[0].data.purchaseAmounts).toEqual([
      { unit: "lovelace", amount: "1000000" },
    ]);
    expect(
      txJobCreateMock.mock.calls[0]?.[0].data.purchaseAmountMatchRequired,
    ).toBe(true);
  });

  it("does not require an amount match when the drift guard was omitted", async () => {
    // Legacy V1 metadata may register more amounts than POST /purchase
    // accepts, so the guard is omitted and the node can lock a drifted price.
    // Recording the snapshot as authoritative would make the job-sync backfill
    // refuse that purchase forever.
    const manyAmounts = Array.from({ length: 8 }, (_unused, index) => ({
      unit: `token-${index}`,
      amount: BigInt(1_000 + index),
    }));
    const agentRecord = createPaidV1AgentRecord();
    agentFindFirstMock.mockResolvedValue({
      ...agentRecord,
      pricing: {
        ...agentRecord.pricing,
        fixedPricing: { amounts: manyAmounts },
      },
    });
    getAgentCostMock.mockReturnValue({ cents: BigInt(1) });
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding(paidV1JobResponse),
    });

    await createAgentJobForUser(createInput());

    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      expect.any(Object),
      { prompt: "hello" },
      expect.any(String),
      undefined,
    );
    expect(
      txJobCreateMock.mock.calls[0]?.[0].data.purchaseAmountMatchRequired,
    ).toBe(false);
  });

  it("hires a legacy agent that returns V2-shaped payment fields", async () => {
    // A V1 seller upgrading its SDK may echo V2 fields. main ignored them;
    // rejecting would break those agents mid-rollout, and only after
    // start_job already created a job on the seller side.
    agentFindFirstMock.mockResolvedValue(createPaidV1AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding({
        ...paidV1JobResponse,
        paymentSourceType: "Web3CardanoV2",
        supportedPaymentSourceIndex: 0,
      }),
    });

    await createAgentJobForUser(createInput());

    expect(txJobCreateMock).toHaveBeenCalled();
    const createCall = txJobCreateMock.mock.calls[0]?.[0];
    // The stored rail stays V1 — the agent record is the source of truth.
    expect(createCall.data.supportedPaymentSourceIndex).toBeUndefined();
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
      startPaidAgentJob: sellerResponding(paidV1JobResponse),
    });

    await createAgentJobForUser(createInput());

    // The payment node compares Amounts as per-unit sums, so duplicate-unit
    // pricing rows must arrive as a single summed entry.
    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      {
        ...paidV1JobResponse,
        identifierFromPurchaser: expect.any(String),
        // The V1 branch records the rail explicitly and drops any stray V2
        // index the seller echoed.
        paymentSourceType: "Web3CardanoV1",
        supportedPaymentSourceIndex: undefined,
      },
      { prompt: "hello" },
      expect.any(String),
      // ADA leaves as an empty unit per the node's /purchase contract.
      [{ unit: "", amount: "1000000" }],
    );
  });

  it("enforces maxAcceptedCents against the selected V2 source", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    // Every purchase-ready source is checked before start_job. Source 2
    // exceeds the cap, so seller work must never start.
    calculateCentsFromMasumiAmountStringsMock.mockImplementation(
      (amounts: { unit: string; amount: string }[]) =>
        amounts.some((entry) => entry.amount === "2000000")
          ? BigInt(11)
          : BigInt(2),
    );
    const startPaidAgentJobMock = sellerResponding(paidV2JobResponse);
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Credit cost exceeds maximum accepted credits",
    );

    expect(startPaidAgentJobMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("applies the buyer cap to source prices for registry-identified V2 agents", async () => {
    const policyId = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";
    const agentIdentifier = `${policyId}${"ab".repeat(29)}000002`;
    agentFindFirstMock.mockResolvedValue({
      ...createPaidV2AgentRecord(),
      blockchainIdentifier: agentIdentifier,
      paymentType: PaymentType.NONE,
    });
    getAgentCostMock.mockReturnValue({ cents: BigInt(200) });
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId,
        smartContractAddress: "addr_test1_v2_contract",
      },
    ]);
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(100));
    const startPaidAgentJobMock = sellerResponding({
      ...paidV2JobResponse,
      agentIdentifier,
    });
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    await createAgentJobForUser(
      createInput({
        agentInput: {
          ...createInput().agentInput,
          maxAcceptedCents: BigInt(150),
        },
      }),
    );

    expect(startPaidAgentJobMock).toHaveBeenCalled();
    expect(creditBucketPrepareConsumptionMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      BigInt(100),
      expect.any(Object),
    );
  });

  it("takes the free flow for a FREE-priced V2 agent even with a paid source and no cap", async () => {
    // Regression guard: a Free+Fixed multi-source V2 agent projects FREE
    // pricing; the cheapest-ready-source floor must not run for the free
    // flow, which never charges and consults no cap.
    agentFindFirstMock.mockResolvedValue({
      ...createPaidV2AgentRecord(),
      pricing: {
        pricingType: PricingType.FREE,
        fixedPricing: null,
      },
    });
    getAgentCostMock.mockReturnValue({ cents: BigInt(0) });
    // The agent's fixed source is expensive; it must be irrelevant here.
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(999));
    const startFreeAgentJobMock = vi
      .fn()
      .mockResolvedValue(ok({ id: "agent_job_free" }));
    createAgentClientMock.mockReturnValue({
      startFreeAgentJob: startFreeAgentJobMock,
    });

    await createAgentJobForUser(
      createInput({
        agentInput: {
          ...createInput().agentInput,
          maxAcceptedCents: undefined,
        },
      }),
    );

    expect(startFreeAgentJobMock).toHaveBeenCalled();
    expect(txJobCreateMock).toHaveBeenCalled();
  });

  it("accepts an uppercase-hex agent identifier echoed by the seller", async () => {
    // Stored V2 identifiers are lowercase; a seller echoing uppercase hex is
    // the same agent and must not orphan the job it just started.
    const v2Identifier = `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b${"ab".repeat(29)}000002`;
    agentFindFirstMock.mockResolvedValue({
      ...createPaidV2AgentRecord(),
      blockchainIdentifier: v2Identifier,
    });
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
        smartContractAddress: "addr_test1_v2_contract",
      },
    ]);
    const startPaidAgentJobMock = sellerResponding({
      ...paidV2JobResponse,
      agentIdentifier: v2Identifier.toUpperCase(),
    });
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    await createAgentJobForUser(createInput());

    expect(startPaidAgentJobMock).toHaveBeenCalled();
    expect(txJobCreateMock).toHaveBeenCalled();
  });

  it("reports an orphaned seller job when the seller echoes another agent", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding({
        ...paidV2JobResponse,
        agentIdentifier: "different-agent-chain",
      }),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid agent job returned a different agent identifier",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Seller-side job orphaned after start_job: seller returned a different agent identifier",
      ),
      expect.objectContaining({
        agentId: "agent_1",
        expectedAgentIdentifier: "agent-chain",
        receivedAgentIdentifier: "different-agent-chain",
      }),
    );
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("Seller-side job orphaned"),
    });
    expect(txJobCreateMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("reports an orphaned seller job when the seller echoes a different purchaser identifier", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      // Ignores the nonce we sent and returns its own.
      startPaidAgentJob: vi
        .fn()
        .mockResolvedValue(
          ok({ ...paidV2JobResponse, identifierFromPurchaser: "not-ours" }),
        ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid agent job returned a different purchaser identifier",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Seller-side job orphaned after start_job: seller returned a different purchaser identifier",
      ),
      expect.objectContaining({
        agentId: "agent_1",
        agentJobId: "agent_job_1",
        receivedIdentifierFromPurchaser: "not-ours",
      }),
    );
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("Seller-side job orphaned"),
    });
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("reports a stranded seller job when start_job answers 2xx with an off-contract body", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      // The seller accepted the job and is working on it, but omitted the
      // fields the MIP-003 contract requires — exactly the shape observed on
      // preprod, where the seller returned identifier_from_seller and no
      // agentIdentifier/sellerVKey/unlockTime.
      startPaidAgentJob: vi.fn().mockResolvedValue(
        err({
          kind: "invalid-response",
          message: "Failed to parse start job response: {...}",
        }),
      ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid agent job start failed: Failed to parse start job response",
    );

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("Seller-side job orphaned"),
    });
    expect(txJobCreateMock).not.toHaveBeenCalled();
  });

  it("stays silent when start_job transport fails after dispatch", async () => {
    // A timeout or 5xx after dispatch is indistinguishable from ordinary
    // seller flakiness and is the most common way a hire fails. No credits
    // have been charged at this point, so the user simply sees a failed hire.
    // Paging here would bury the invalid-response case below in noise.
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(
        err({
          kind: "ambiguous",
          message: "connection reset after request dispatch",
        }),
      ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid agent job start failed: connection reset after request dispatch",
    );

    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
  });

  it("pages when the seller accepted the job but returned an unusable body", async () => {
    // 2xx means the seller took the job and started work. We cannot record
    // it and MIP-003 has no cancel, so this one is a definite strand.
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: vi.fn().mockResolvedValue(
        err({
          kind: "invalid-response",
          message: "start_job response was not valid JSON",
        }),
      ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid agent job start failed: start_job response was not valid JSON",
    );

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("does not match the MIP-003 contract"),
    });
    expect(txJobCreateMock).not.toHaveBeenCalled();
  });

  it("stays silent when the seller never accepted the job", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      // Explicit non-2xx: nothing was accepted, so an ordinary failed hire
      // must not page.
      startPaidAgentJob: vi
        .fn()
        .mockResolvedValue(
          err({ kind: "unreachable", message: "Failed to start agent job" }),
        ),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid agent job start failed: Failed to start agent job",
    );

    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
  });

  it("rejects maxCredits below the cheapest eligible V2 source before contacting the seller", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    // Every stored source costs more than the accepted cap of 10 cents, so
    // no seller selection could ever satisfy it.
    calculateCentsFromMasumiAmountStringsMock.mockReturnValue(BigInt(11));
    const startPaidAgentJobMock = sellerResponding(paidV2JobResponse);
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
    const startPaidAgentJobMock = sellerResponding(paidV2JobResponse);
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
      "The agent's purchase-ready payment sources exceed its listed price",
    );
    await expect(promise).rejects.toMatchObject({ status: 422 });

    expect(startPaidAgentJobMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("reports an orphaned seller job when the response selects an unknown payment source", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding({
        ...paidV2JobResponse,
        supportedPaymentSourceIndex: 3,
      }),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent job returned an unexpected payment source",
    );

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining(
        "seller returned an unexpected payment source",
      ),
    });
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("defaults to the only source when a V2 seller omits the index", async () => {
    // Observed on preprod: a compliant seller that returns every required
    // field but no supportedPaymentSourceIndex. With exactly one registered
    // source there is nothing else it could have meant.
    const singleSourceAgent = createPaidV2AgentRecord();
    singleSourceAgent.paymentSources = [
      {
        sourceIndex: 0,
        address: "addr_test1_v2_contract",
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(1_000_000) }],
      },
    ];
    agentFindFirstMock.mockResolvedValue(singleSourceAgent);
    const { supportedPaymentSourceIndex: _omitted, ...withoutIndex } =
      paidV2JobResponse;
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding(withoutIndex),
    });

    await createAgentJobForUser(createInput());

    expect(txJobCreateMock).toHaveBeenCalled();
    // The node rebuilds the signed payload from this value, so the resolved
    // index must be forwarded rather than the seller's (absent) echo.
    expect(createPurchaseMock.mock.calls[0]?.[1]).toMatchObject({
      supportedPaymentSourceIndex: 0,
      paymentSourceType: "Web3CardanoV2",
    });
  });

  it("still requires the index when a V2 agent has several sources", async () => {
    // Two registered sources: only the seller knows which it will settle
    // through, and guessing would bill from the wrong price.
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    const { supportedPaymentSourceIndex: _omitted, ...withoutIndex } =
      paidV2JobResponse;
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding(withoutIndex),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent job returned an unexpected payment source",
    );

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining(
        "seller returned an unexpected payment source",
      ),
    });
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("rejects with no ready sources before contacting the seller", async () => {
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: "agent-chain",
        smartContractAddress: "addr_test1_other_contract",
      },
    ]);
    const startPaidAgentJobMock = sellerResponding(paidV2JobResponse);
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: startPaidAgentJobMock,
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "No purchase-ready payment sources available for this agent",
    );

    expect(startPaidAgentJobMock).not.toHaveBeenCalled();
    expect(createAgentClientMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("reports an orphaned seller job when the seller selects a non-ready source", async () => {
    // One ready source, one not. Seller echoes the non-ready index after
    // start_job — refuse payment and page the orphan.
    const agent = createPaidV2AgentRecord();
    agent.paymentSources = [
      {
        sourceIndex: 0,
        address: "addr_test1_ready_contract",
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(1_000_000) }],
      },
      {
        sourceIndex: 2,
        address: "addr_test1_not_ready_contract",
        pricingType: PricingType.FIXED,
        amounts: [{ unit: "lovelace", amount: BigInt(2_000_000) }],
      },
    ];
    agentFindFirstMock.mockResolvedValue(agent);
    getCardanoV2ReadySourcesMock.mockResolvedValue([
      {
        policyId: "agent-chain",
        smartContractAddress: "addr_test1_ready_contract",
      },
    ]);
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding(paidV2JobResponse),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent job selected a payment source that is not purchase-ready",
    );

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining(
        "seller selected a payment source that is not purchase-ready",
      ),
    });
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
      startPaidAgentJob: sellerResponding(paidV2JobResponse),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent has a purchase-ready source with too many assets",
    );

    expect(createAgentClientMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("rejects an unbillable ready source before starting seller work", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    calculateCentsFromMasumiAmountStringsMock.mockImplementation(() => {
      throw new Error("Credit cost not found for unit some-token");
    });
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding(paidV2JobResponse),
    });

    await expect(createAgentJobForUser(createInput())).rejects.toThrow(
      "Paid V2 agent has a purchase-ready source with unbillable units",
    );

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(createAgentClientMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("rejects a ready source above the buyer cap before starting seller work", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    agentFindFirstMock.mockResolvedValue(createPaidV2AgentRecord());
    // Source 2 exceeds the cap. Preflight rejects before seller work starts.
    calculateCentsFromMasumiAmountStringsMock.mockImplementation(
      (amounts: { unit: string; amount: string }[]) =>
        amounts.some((entry) => entry.amount === "2000000")
          ? BigInt(200)
          : BigInt(100),
    );
    createAgentClientMock.mockReturnValue({
      startPaidAgentJob: sellerResponding(paidV2JobResponse),
    });

    await expect(
      createAgentJobForUser(
        createInput({
          agentInput: {
            ...createInput().agentInput,
            maxAcceptedCents: BigInt(150),
          },
        }),
      ),
    ).rejects.toThrow("Credit cost exceeds maximum accepted credits");

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(createAgentClientMock).not.toHaveBeenCalled();
    expect(txJobCreateMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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
      startPaidAgentJob: sellerResponding(paidV1JobResponse),
    });

    await createAgentJobForUser(createInput());

    expect(createPurchaseMock).toHaveBeenCalledWith(
      "agent-chain",
      {
        ...paidV1JobResponse,
        identifierFromPurchaser: expect.any(String),
        // The V1 branch records the rail explicitly and drops any stray V2
        // index the seller echoed.
        paymentSourceType: "Web3CardanoV1",
        supportedPaymentSourceIndex: undefined,
      },
      { prompt: "hello" },
      expect.any(String),
      undefined,
    );
    expect(txJobCreateMock.mock.calls[0]?.[0].data.purchaseAmounts).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        unit: `unit-${index}`,
        amount: String(index + 1),
      })),
    );
  });
});
