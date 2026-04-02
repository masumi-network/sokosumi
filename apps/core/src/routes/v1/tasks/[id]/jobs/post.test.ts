import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostTaskJob from "./post";

const { createAgentJobForUserMock, flattenJobMock, requireTaskAccessMock } =
  vi.hoisted(() => ({
    createAgentJobForUserMock: vi.fn(),
    flattenJobMock: vi.fn(),
    requireTaskAccessMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerTaskAccess: requireTaskAccessMock,
}));

vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));

vi.mock("@/types/job", () => ({
  flattenJob: flattenJobMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: object) => unknown) => {
      return await callback({});
    },
  },
}));

describe("POST /tasks/{id}/jobs", () => {
  function createApp() {
    const app = new OpenAPIHono<{
      Variables: AuthVariables;
    }>();

    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
      });

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
    });
  });

  it("inherits workspace placement from the parent task", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
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
});
