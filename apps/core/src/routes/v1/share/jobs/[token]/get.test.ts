import { OpenAPIHono } from "@hono/zod-openapi";
import { AgentJobStatus, JobType, SokosumiJobStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import mountGetSharedJobByToken from "./get";

const { prismaTransactionMock, getShareByTokenMock, getJobByIdMock } =
  vi.hoisted(() => ({
    prismaTransactionMock: vi.fn(),
    getShareByTokenMock: vi.fn(),
    getJobByIdMock: vi.fn(),
  }));

vi.mock("@sokosumi/database/repositories", () => ({
  jobRepository: {
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  },
  jobShareRepository: {
    getShareByToken: (...args: unknown[]) => getShareByTokenMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
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
    taskId: null,
    name: "Shared Job",
    jobType: JobType.PAID,
    status: SokosumiJobStatus.COMPLETED,
    credits: 5,
    agentJobId: "agent_job_123",
    identifierFromPurchaser: "identifier_123",
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
    transaction: {
      amount: BigInt(5000000),
    },
    purchase: {
      onChainStatus: null,
      onChainTransactionHash: "0x123abc",
      resultHash: "result_hash_123",
    },
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
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
    );
    getShareByTokenMock.mockResolvedValue({
      id: "share_123",
      jobId: "job_123",
      token: "public-share-token",
      allowSearchIndexing: false,
      createdAt: new Date("2026-03-26T10:00:00.000Z"),
      updatedAt: new Date("2026-03-26T10:00:00.000Z"),
    });
    getJobByIdMock.mockResolvedValue(createJob());
  });

  it("returns the shared job for a valid token", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/public-share-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getShareByTokenMock).toHaveBeenCalledWith("public-share-token", {});
    expect(getJobByIdMock).toHaveBeenCalledWith("job_123", {});
    expect(body.data.share.allowSearchIndexing).toBe(false);
    expect(body.data.job.id).toBe("job_123");
    expect(body.data.job.transaction.amount).toBe("5000000");
  });

  it("returns 404 for an unknown token", async () => {
    getShareByTokenMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/public-share-token");

    expect(response.status).toBe(404);
    expect(getJobByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the shared job is missing", async () => {
    getJobByIdMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/public-share-token");

    expect(response.status).toBe(404);
  });
});
