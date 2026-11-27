import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostAgentRating from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  doesUserHaveFinishedJobWithAgentMock,
  prismaTransactionMock,
  requireAvailableAgentMock,
  upsertUserAgentReviewMock,
} = vi.hoisted(() => ({
  doesUserHaveFinishedJobWithAgentMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireAvailableAgentMock: vi.fn(),
  upsertUserAgentReviewMock: vi.fn(),
}));

vi.mock("@/lib/agent-catalog/availability", () => ({
  requireAvailableAgent: requireAvailableAgentMock,
}));

vi.mock("@/helpers/agent-rating", () => ({
  upsertUserAgentReview: upsertUserAgentReviewMock,
  doesUserHaveFinishedJobWithAgent: doesUserHaveFinishedJobWithAgentMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
  networkPrisma: () => ({
    $transaction: prismaTransactionMock,
  }),
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

  mountPostAgentRating(app);
  return app;
}

function postRating(body: unknown) {
  return new Request("http://localhost/agent_123/ratings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /agents/{id}/ratings", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAvailableAgentMock.mockResolvedValue(undefined);
    doesUserHaveFinishedJobWithAgentMock.mockResolvedValue(true);
    upsertUserAgentReviewMock.mockResolvedValue({
      id: "rating_123",
      rating: 5,
      comment: "Great results.",
    });
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({});
    });
  });

  it("creates a rating when the caller is eligible", async () => {
    const app = createApp();
    const response = await app.request(
      postRating({ rating: 5, comment: "Great results." }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(requireAvailableAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      "agent_123",
      expect.anything(),
    );
    expect(doesUserHaveFinishedJobWithAgentMock).toHaveBeenCalledWith(
      "user_123",
      "agent_123",
      expect.anything(),
    );
    expect(upsertUserAgentReviewMock).toHaveBeenCalledWith(
      "agent_123",
      "user_123",
      5,
      "Great results.",
      expect.anything(),
    );
    expect(body.data).toEqual({
      id: "rating_123",
      rating: 5,
      comment: "Great results.",
    });
  });

  it("returns 403 when the caller has no finished job with the agent", async () => {
    doesUserHaveFinishedJobWithAgentMock.mockResolvedValue(false);

    const app = createApp();
    const response = await app.request(postRating({ rating: 5 }));

    expect(response.status).toBe(403);
    expect(upsertUserAgentReviewMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the agent is not available", async () => {
    requireAvailableAgentMock.mockRejectedValue(notFound("Agent not found"));

    const app = createApp();
    const response = await app.request(postRating({ rating: 5 }));

    expect(response.status).toBe(404);
    expect(doesUserHaveFinishedJobWithAgentMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range rating", async () => {
    const app = createApp();
    const response = await app.request(postRating({ rating: 6 }));

    expect(response.status).toBe(422);
    expect(requireAvailableAgentMock).not.toHaveBeenCalled();
  });
});
