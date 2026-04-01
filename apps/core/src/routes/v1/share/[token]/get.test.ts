import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import mountGetSharedResourceByToken from "./get";

const { getPublicSharedResourceByTokenMock } = vi.hoisted(() => ({
  getPublicSharedResourceByTokenMock: vi.fn(),
}));

vi.mock("@/helpers/public-share", () => ({
  getPublicSharedResourceByToken: (...args: unknown[]) =>
    getPublicSharedResourceByTokenMock(...args),
}));

function createApp() {
  const app = new OpenAPIHono();
  mountGetSharedResourceByToken(app);
  return app;
}

describe("GET /share/{token}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a shared job for a job token", async () => {
    getPublicSharedResourceByTokenMock.mockResolvedValue({
      kind: "job",
      share: {
        id: "share_123",
        jobId: "job_123",
        token: "public-share-token",
        allowSearchIndexing: false,
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      job: {
        id: "job_123",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:05:00.000Z"),
        completedAt: new Date("2026-03-26T10:10:00.000Z"),
        agentId: "agent_123",
        userId: "user_123",
        organizationId: "org_123",
        taskId: null,
        name: "Shared Job",
        jobType: "PAID",
        status: "completed",
        credits: 0.0005,
        onChainStatus: null,
        onChainTransactionHash: "0x123abc",
        result: "# Result",
        resultHash: "result_hash_123",
        input: '{"prompt":"hello"}',
        inputHash: null,
        inputSchema: '{"input_data":[]}',
        agentJobId: "agent_job_123",
        identifierFromPurchaser: "identifier_123",
        user: {
          id: "user_123",
          name: "Ada Lovelace",
          image: null,
        },
        organization: {
          id: "org_123",
          name: "Acme Labs",
          slug: "acme-labs",
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
        events: [],
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/public-share-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.kind).toBe("job");
    expect(body.data.share.jobId).toBe("job_123");
    expect(body.data.job.id).toBe("job_123");
  });

  it("returns a shared task for a task token", async () => {
    getPublicSharedResourceByTokenMock.mockResolvedValue({
      kind: "task",
      share: {
        id: "share_123",
        taskId: "tsk_123",
        token: "public-share-token",
        allowSearchIndexing: true,
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T10:00:00.000Z"),
      },
      task: {
        id: "tsk_123",
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T10:10:00.000Z"),
        name: "Shared Task",
        description: "Task description",
        status: "READY",
        coworker: {
          id: "cow_123",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
        jobs: [
          {
            id: "job_123",
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
            completedAt: null,
            name: "Nested job",
            status: "processing",
            agentName: "Research Agent",
            shareToken: null,
          },
        ],
        events: [
          {
            id: "evt_123",
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
            updatedAt: new Date("2026-03-30T10:05:00.000Z"),
            origin: "SOKOSUMI",
            status: "RUNNING",
            comment: null,
            credits: 1.5,
            actorName: null,
            actorImage: null,
          },
        ],
      },
    });

    const app = createApp();
    const response = await app.request("http://localhost/public-share-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.kind).toBe("task");
    expect(body.data.share.taskId).toBe("tsk_123");
    expect(body.data.task.name).toBe("Shared Task");
    expect(body.data.task.jobs[0].shareToken).toBeNull();
    expect(body.data.task.events).toEqual([
      expect.objectContaining({
        id: "evt_123",
        status: "RUNNING",
      }),
    ]);
  });

  it("returns 404 for an unknown token", async () => {
    getPublicSharedResourceByTokenMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/public-share-token");

    expect(response.status).toBe(404);
  });
});
