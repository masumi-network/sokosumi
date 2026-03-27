import { OpenAPIHono } from "@hono/zod-openapi";
import { AgentJobStatus, JobType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import mountGetSharedJobByToken from "./get";

const { jobShareFindUniqueMock } = vi.hoisted(() => ({
  jobShareFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    jobShare: {
      findUnique: (...args: unknown[]) => jobShareFindUniqueMock(...args),
    },
  },
}));

function createApp() {
  const app = new OpenAPIHono();
  mountGetSharedJobByToken(app);
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
    organizationId: null,
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
    organization: null,
    transaction: {
      amount: BigInt(5000000),
    },
    transactionId: "txn_123",
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

describe("GET /share/jobs/{token}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobShareFindUniqueMock.mockResolvedValue({
      id: "share_123",
      jobId: "job_123",
      token: "public-share-token",
      allowSearchIndexing: false,
      createdAt: new Date("2026-03-26T10:00:00.000Z"),
      updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      job: createJob(),
    });
  });

  it("returns the shared job for a valid token", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/public-share-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobShareFindUniqueMock).toHaveBeenCalledWith({
      where: { token: "public-share-token" },
      include: {
        job: {
          include: expect.any(Object),
        },
      },
    });
    expect(body.data.share.allowSearchIndexing).toBe(false);
    expect(body.data.job.id).toBe("job_123");
    expect(body.data.job.credits).toBe(0.0005);
    expect(body.data.job.onChainTransactionHash).toBe("0x123abc");
    expect(body.data.job.onChainStatus).toBeNull();
    expect(body.data.job).not.toHaveProperty("transaction");
    expect(body.data.job).not.toHaveProperty("purchase");
  });

  it("returns 404 for an unknown token", async () => {
    jobShareFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/public-share-token");

    expect(response.status).toBe(404);
  });

});
