import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostTaskJob from "./post";

const { createAgentJobForUserMock, flattenJobMock, requireTaskAccessMock } =
  vi.hoisted(() => ({
    createAgentJobForUserMock: vi.fn(),
    flattenJobMock: vi.fn(),
    requireTaskAccessMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerTaskCollaboration: requireTaskAccessMock,
}));

vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));

vi.mock("@/types/job", () => ({
  flattenJob: flattenJobMock,
}));

describe("POST /tasks/{id}/jobs", () => {
  function createApp(authContext: AuthVariables["authContext"]) {
    const app = new OpenAPIHono<{
      Variables: AuthVariables;
    }>();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContext);

      return await next();
    });

    mountPostTaskJob(app as unknown as OpenAPIHonoWithAuth);

    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskAccessMock.mockResolvedValue({
      id: "tsk_123",
      userId: "user_123",
      organizationId: "org_123",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      status: TaskStatus.READY,
    });
    createAgentJobForUserMock.mockResolvedValue({
      id: "job_123",
    });
    flattenJobMock.mockReturnValue({
      id: "job_123",
      createdAt: "2026-04-02T08:00:00.000Z",
      updatedAt: "2026-04-02T08:00:00.000Z",
      completedAt: null,
      agentId: "agent_123",
      userId: "user_123",
      organizationId: "org_123",
      taskId: "tsk_123",
      name: null,
      jobType: "FREE",
      status: "processing",
      credits: 0,
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

  const requestBody = JSON.stringify({
    agentId: "agent_123",
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
  });

  it("inherits workspace placement from the parent task", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    });

    const response = await app.request("http://localhost/tsk_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    expect(response.status).toBe(201);
    expect(createAgentJobForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          userId: "user_123",
          organizationId: "org_123",
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
        taskContext: {
          taskId: "tsk_123",
        },
      }),
    );
  });

  it("uses assigned-agent collaboration, not delegation, to resolve the task", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      delegation: {
        userId: "user_123",
        organizationId: "org_123",
      },
    });

    const response = await app.request("http://localhost/tsk_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    // The endpoint is coworker-scoped and routes through the coworker-only
    // helper, which ignores delegation (assignment is enforced internally).
    expect(response.status).toBe(201);
    expect(requireTaskAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      }),
      "tsk_123",
    );
  });
});
