import { jobSummaryInclude } from "@sokosumi/database/types/job";
import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentJobForUser } from "./job";

const {
  agentFindFirstMock,
  createAgentClientMock,
  generateJobNameMock,
  getAgentCostMock,
  getCreditCostsOrThrowMock,
  projectFindFirstMock,
  prismaTransactionMock,
  txJobCreateMock,
} = vi.hoisted(() => ({
  agentFindFirstMock: vi.fn(),
  createAgentClientMock: vi.fn(),
  generateJobNameMock: vi.fn(),
  getAgentCostMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
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
    generateJobName: generateJobNameMock,
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
    prepareConsumption: vi.fn(),
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
      pricingType: "FREE",
      fixedPricing: null,
    },
  };
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
    getAgentCostMock.mockReturnValue({ cents: BigInt(0) });
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
});
