import { AgentJobStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoJobForUser } from "./job";

const {
  agentFindFirstMock,
  captureExceptionMock,
  createDemoJobMock,
  enqueueFromMarkdownMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  agentFindFirstMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  createDemoJobMock: vi.fn(),
  enqueueFromMarkdownMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/helpers/agent", () => ({
  buildAvailableAgentWhereClause: () => ({}),
  getAgentCost: vi.fn(),
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: vi.fn(),
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateJobName: vi.fn() },
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({ createPurchase: vi.fn() }),
}));

vi.mock("@/helpers/user", () => ({
  getCents: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: { findFirst: agentFindFirstMock },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {},
  jobPurchaseRepository: {},
  jobRepository: { createDemoJob: createDemoJobMock },
}));

vi.mock("@/services/source-import.service", () => ({
  sourceImportService: { enqueueFromMarkdown: enqueueFromMarkdownMock },
}));

function createDemoJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_demo_1",
    events: [
      { id: "event_init", status: AgentJobStatus.INITIATED, result: null },
      {
        id: "event_done",
        status: AgentJobStatus.COMPLETED,
        result: "# Result\n\nhttps://example.com/file.pdf",
      },
    ],
    ...overrides,
  };
}

const REQUEST = {
  inputSchema: { input_data: [] },
  inputData: { topic: "AI" },
  result: "# Result\n\nhttps://example.com/file.pdf",
};

const OWNER = {
  userId: "user_1",
  organizationId: "org_1",
  workspaceId: "ws_1",
};

describe("createDemoJobForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCreditCostsOrThrowMock.mockResolvedValue({});
    agentFindFirstMock.mockResolvedValue({ id: "agent_1" });
    createDemoJobMock.mockResolvedValue(createDemoJobRecord());
    enqueueFromMarkdownMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (cb) => cb({}));
  });

  it("throws not found when the agent is not available", async () => {
    agentFindFirstMock.mockResolvedValue(null);

    await expect(
      createDemoJobForUser({
        owner: OWNER,
        agentId: "agent_1",
        request: REQUEST,
      }),
    ).rejects.toThrow("Agent not found");
    expect(createDemoJobMock).not.toHaveBeenCalled();
  });

  it("creates the demo job and enqueues sources from the completed event", async () => {
    const job = await createDemoJobForUser({
      owner: OWNER,
      agentId: "agent_1",
      request: REQUEST,
    });

    expect(job.id).toBe("job_demo_1");
    expect(createDemoJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent_1",
        userId: "user_1",
        organizationId: "org_1",
        workspaceId: "ws_1",
        input: JSON.stringify(REQUEST.inputData),
        inputSchema: REQUEST.inputSchema,
        name: "Demo Job",
        result: REQUEST.result,
      }),
      expect.anything(),
    );
    expect(enqueueFromMarkdownMock).toHaveBeenCalledWith(
      "event_done",
      REQUEST.result,
    );
  });

  it("swallows source-import failures and still returns the job", async () => {
    enqueueFromMarkdownMock.mockRejectedValue(new Error("enqueue boom"));

    const job = await createDemoJobForUser({
      owner: OWNER,
      agentId: "agent_1",
      request: REQUEST,
    });

    expect(job.id).toBe("job_demo_1");
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("does not enqueue when there is no completed event with a result", async () => {
    createDemoJobMock.mockResolvedValue(
      createDemoJobRecord({
        events: [
          { id: "event_init", status: AgentJobStatus.INITIATED, result: null },
        ],
      }),
    );

    await createDemoJobForUser({
      owner: OWNER,
      agentId: "agent_1",
      request: REQUEST,
    });

    expect(enqueueFromMarkdownMock).not.toHaveBeenCalled();
  });
});
