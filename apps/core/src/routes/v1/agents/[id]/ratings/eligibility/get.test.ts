import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetAgentRatingEligibility from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { doesUserHaveFinishedJobWithAgentMock, requireAvailableAgentMock } =
  vi.hoisted(() => ({
    doesUserHaveFinishedJobWithAgentMock: vi.fn(),
    requireAvailableAgentMock: vi.fn(),
  }));

vi.mock("@/lib/agent-catalog/availability", () => ({
  requireAvailableAgent: requireAvailableAgentMock,
}));

vi.mock("@/helpers/agent-rating", () => ({
  doesUserHaveFinishedJobWithAgent: doesUserHaveFinishedJobWithAgentMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
  networkPrisma: () => ({}),
}));

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetAgentRatingEligibility(app);
  return app;
}

describe("GET /agents/{id}/ratings/eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAvailableAgentMock.mockResolvedValue(undefined);
  });

  it("reports eligibility when the caller has a finished job", async () => {
    doesUserHaveFinishedJobWithAgentMock.mockResolvedValue(true);

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAvailableAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      "agent_123",
    );
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
    requireAvailableAgentMock.mockRejectedValue(notFound("Agent not found"));

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_123/ratings/eligibility",
    );

    expect(response.status).toBe(404);
    expect(doesUserHaveFinishedJobWithAgentMock).not.toHaveBeenCalled();
  });
});
