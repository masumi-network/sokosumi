import { hashInputSchema } from "@sokosumi/masumi/hash";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentJobForUser } from "./job";

const {
  agentFindFirstMock,
  createAgentClientMock,
  getAgentCostMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
  txJobCreateMock,
} = vi.hoisted(() => ({
  agentFindFirstMock: vi.fn(),
  createAgentClientMock: vi.fn(),
  getAgentCostMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  txJobCreateMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  buildAvailableAgentWhereClause: () => ({}),
  getAgentCost: getAgentCostMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: createAgentClientMock,
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateJobName: vi.fn(),
  },
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    createPurchase: vi.fn(),
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: {
      findFirst: agentFindFirstMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/user", () => ({
  getCents: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    prepareConsumption: vi.fn(),
  },
  jobPurchaseRepository: {
    createJobPurchase: vi.fn(),
  },
  jobShareRepository: {
    upsertOrganizationShare: vi.fn(),
    upsertPublicShare: vi.fn(),
  },
}));

function createAgentRecord() {
  return {
    id: "agent_1",
    name: "Agent One",
    description: "desc",
    apiBaseUrl: "https://agent.example.com",
    overrideApiBaseUrl: null,
    blockchainIdentifier: "agent-chain",
    pricing: {
      pricingType: "FREE",
      fixedPricing: null,
    },
  };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    owner: {
      userId: "user_1",
      organizationId: "org_1",
    },
    agentInput: {
      agentId: "agent_1",
      inputData: { prompt: "hello" },
      inputSchema: {
        input_data: [
          {
            id: "prompt",
            type: "string",
            name: "prompt",
          },
        ],
      },
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
    agentFindFirstMock.mockResolvedValue(createAgentRecord());
    createAgentClientMock.mockReturnValue({
      startFreeAgentJob: vi.fn().mockResolvedValue(ok({ id: "agent_job_1" })),
    });
    txJobCreateMock.mockResolvedValue({
      id: "job_1",
      agentId: "agent_1",
      userId: "user_1",
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

  it("connects scheduled jobs to jobScheduleId via scheduleContext", async () => {
    const expectedInputSchema = JSON.stringify([
      {
        id: "prompt",
        type: "string",
        name: "prompt",
      },
    ]);

    await createAgentJobForUser(
      createInput({
        scheduleContext: {
          jobScheduleId: "schedule_1",
        },
      }),
    );

    expect(txJobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobSchedule: {
            connect: {
              id: "schedule_1",
            },
          },
          events: {
            create: expect.objectContaining({
              inputSchema: expectedInputSchema,
              inputSchemaHash: hashInputSchema(expectedInputSchema),
            }),
          },
        }),
      }),
    );
  });
});
