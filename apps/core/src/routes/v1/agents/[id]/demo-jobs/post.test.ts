import { OpenAPIHono } from "@hono/zod-openapi";
import { AgentJobStatus, JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountPostDemoJob from "./post";

const { createDemoJobForUserMock, serializeJobDetailsMock } = vi.hoisted(
  () => ({
    createDemoJobForUserMock: vi.fn(),
    serializeJobDetailsMock: vi.fn(),
  }),
);

vi.mock("@/helpers/job", () => ({
  createDemoJobForUser: createDemoJobForUserMock,
}));

vi.mock("@/types/job", () => ({
  serializeJobDetails: serializeJobDetailsMock,
}));

function createSerializedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_123",
    createdAt: "2026-03-26T10:00:00.000Z",
    updatedAt: "2026-03-26T10:05:00.000Z",
    completedAt: null,
    agentId: "agent_123",
    userId: "user_123",
    organizationId: "org_123",
    projectId: null,
    taskId: null,
    name: "Demo Job",
    jobType: JobType.DEMO,
    status: SokosumiJobStatus.COMPLETED,
    credits: 0,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: "# Result",
    resultHash: null,
    input: "{}",
    inputHash: null,
    inputSchema: null,
    agentJobId: "agent_job_123",
    identifierFromPurchaser: null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: { id: "org_123", name: "Acme Labs", slug: "acme-labs" },
    },
    user: { id: "user_123", name: "Ada Lovelace", image: null },
    organization: { id: "org_123", name: "Acme Labs", slug: "acme-labs" },
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
    events: [
      {
        id: "event_1",
        createdAt: "2026-03-26T10:00:00.000Z",
        updatedAt: "2026-03-26T10:00:00.000Z",
        status: AgentJobStatus.COMPLETED,
        inputSchema: null,
        input: null,
        result: "# Result",
        blobs: [],
        links: [],
      },
    ],
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & RequestIdVariables;
  }>({ defaultHook: defaultValidationHook });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_demo_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    });
    await next();
  });

  app.onError(errorHandler);
  mountPostDemoJob(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const VALID_BODY = {
  inputSchema: { input_data: [] },
  inputData: { topic: "AI" },
  result: "# Result\n\nhttps://example.com/output.pdf",
};

describe("POST /agents/{id}/demo-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDemoJobForUserMock.mockResolvedValue({ id: "job_123" });
    serializeJobDetailsMock.mockReturnValue(createSerializedJob());
  });

  it("creates a demo job and returns 201 with the serialized job", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/demo-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const body = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("job_123");
    expect(createDemoJobForUserMock).toHaveBeenCalledWith({
      owner: {
        userId: "user_123",
        organizationId: "org_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      agentId: "agent_123",
      request: expect.objectContaining({
        inputData: { topic: "AI" },
        result: VALID_BODY.result,
      }),
    });
  });

  it("returns 404 when the agent is not available", async () => {
    createDemoJobForUserMock.mockRejectedValue(notFound("Agent not found"));
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/demo-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(response.status).toBe(404);
  });
});
