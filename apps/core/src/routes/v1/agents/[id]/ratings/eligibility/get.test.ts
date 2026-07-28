import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatZodErrorMessage,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetAgentRatingEligibility from "./get";

const {
  doesUserHaveFinishedJobWithAgentMock,
  prismaTransactionMock,
  requireAvailableAgentOrThrowMock,
} = vi.hoisted(() => ({
  doesUserHaveFinishedJobWithAgentMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireAvailableAgentOrThrowMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  getCardanoV2ReadySources: () => Promise.resolve([]),
  requireAvailableAgentOrThrow: requireAvailableAgentOrThrowMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobRepository: {
    doesUserHaveFinishedJobWithAgent: doesUserHaveFinishedJobWithAgentMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetAgentRatingEligibility(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /agents/{id}/ratings/eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAvailableAgentOrThrowMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({});
    });
  });

  it("reports eligibility when the caller has a finished job", async () => {
    doesUserHaveFinishedJobWithAgentMock.mockResolvedValue(true);

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ eligible: true });
  });

  it("reports ineligibility when the caller has no finished job", async () => {
    doesUserHaveFinishedJobWithAgentMock.mockResolvedValue(false);

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ eligible: false });
  });

  it("returns 404 when the agent is not available", async () => {
    requireAvailableAgentOrThrowMock.mockRejectedValue(
      notFound("Agent not found"),
    );

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );

    expect(response.status).toBe(404);
    expect(doesUserHaveFinishedJobWithAgentMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    doesUserHaveFinishedJobWithAgentMock.mockResolvedValue(true);

    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    });
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ eligible: true });
    expect(doesUserHaveFinishedJobWithAgentMock).toHaveBeenCalledWith(
      "user_123",
      "agent_123",
      expect.anything(),
    );
  });

  it("returns 403 for bare orchestrator without context headers", async () => {
    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
    });
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );

    expect(response.status).toBe(403);
    expect(doesUserHaveFinishedJobWithAgentMock).not.toHaveBeenCalled();
  });
});
