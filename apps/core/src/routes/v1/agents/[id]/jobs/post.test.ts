import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostAgentJob from "./post";

const { createAgentJobForUserMock, flattenJobMock } = vi.hoisted(() => ({
  createAgentJobForUserMock: vi.fn(),
  flattenJobMock: vi.fn(),
}));

vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));

vi.mock("@/types/job", () => ({
  flattenJob: flattenJobMock,
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
} satisfies WorkspaceVariables["workspaceContext"];

const JOB_PAYLOAD = {
  inputSchema: {
    input_data: [
      {
        id: "prompt",
        type: "string",
        name: "Prompt",
      },
    ],
  },
  inputData: {
    prompt: "hello",
  },
  maxCredits: 5,
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  mountPostAgentJob(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("POST /agents/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentJobForUserMock.mockResolvedValue({
      id: "job_123",
    });
    flattenJobMock.mockReturnValue({
      id: "job_123",
      createdAt: "2026-04-02T08:00:00.000Z",
      updatedAt: "2026-04-02T08:00:00.000Z",
      completedAt: null,
      agentId: "agent_123",
      ownerId: "user_123",
      owner: {
        id: "user_123",
        name: "Ada Lovelace",
        image: null,
      },
      userId: "user_123",
      organizationId: "org_123",
      taskId: null,
      name: null,
      jobType: "FREE",
      status: "processing",
      credits: 0,
      jobStatusSettled: false,
      onChainStatus: null,
      onChainTransactionHash: null,
      result: null,
      resultHash: null,
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: "org_123",
        organization: {
          id: "org_123",
          name: "Acme Labs",
          slug: "acme-labs",
        },
      },
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
    });
  });

  it("uses workspaceContext for standalone job creation", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(JOB_PAYLOAD),
    });

    expect(response.status).toBe(201);
    expect(createAgentJobForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          ownerId: "user_123",
          organizationId: "org_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
  });

  it("passes projectId through for standalone job creation", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/agent_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...JOB_PAYLOAD,
        projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      }),
    });

    expect(response.status).toBe(201);
    expect(createAgentJobForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentInput: expect.objectContaining({
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        }),
      }),
    );
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const coworkerAuth: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: "org_123" },
    };

    const app = createApp(coworkerAuth);
    const response = await app.request("http://localhost/agent_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(JOB_PAYLOAD),
    });

    expect(response.status).toBe(403);
    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers", async () => {
    const orchestratorAuth: AuthenticationContext = {
      actor: "orchestrator",
      context: { userId: "user_123", organizationId: "org_123" },
    };

    const app = createApp(orchestratorAuth);
    const response = await app.request("http://localhost/agent_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(JOB_PAYLOAD),
    });

    expect(response.status).toBe(201);
    expect(createAgentJobForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          ownerId: "user_123",
          organizationId: "org_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
      }),
    );
  });
});
