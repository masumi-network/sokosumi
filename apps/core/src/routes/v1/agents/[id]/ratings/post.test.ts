import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatZodErrorMessage,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostAgentRating from "./post";

const {
  doesUserHaveFinishedJobWithAgentMock,
  prismaTransactionMock,
  requireAvailableAgentOrThrowMock,
  upsertUserAgentReviewMock,
} = vi.hoisted(() => ({
  doesUserHaveFinishedJobWithAgentMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  requireAvailableAgentOrThrowMock: vi.fn(),
  upsertUserAgentReviewMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  isCardanoV2RailReady: () => Promise.resolve(true),
  requireAvailableAgentOrThrow: requireAvailableAgentOrThrowMock,
  upsertUserAgentReview: upsertUserAgentReviewMock,
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

  mountPostAgentRating(app as unknown as OpenAPIHonoWithAuth);
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

    requireAvailableAgentOrThrowMock.mockResolvedValue(undefined);
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
    requireAvailableAgentOrThrowMock.mockRejectedValue(
      notFound("Agent not found"),
    );

    const app = createApp();
    const response = await app.request(postRating({ rating: 5 }));

    expect(response.status).toBe(404);
    expect(doesUserHaveFinishedJobWithAgentMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range rating", async () => {
    const app = createApp();
    const response = await app.request(postRating({ rating: 6 }));

    expect(response.status).toBe(422);
    expect(requireAvailableAgentOrThrowMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    });
    const response = await app.request(
      postRating({ rating: 5, comment: "Great results." }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
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

  it("returns 403 for bare orchestrator without context headers", async () => {
    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
    });
    const response = await app.request(postRating({ rating: 5 }));

    expect(response.status).toBe(403);
    expect(upsertUserAgentReviewMock).not.toHaveBeenCalled();
  });
});
