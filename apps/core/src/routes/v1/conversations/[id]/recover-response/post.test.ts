import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostRecoverResponse from "./post";

const {
  conversationFindFirstMock,
  conversationItemCreateMock,
  conversationUpdateMock,
  getResponseByIdMock,
  isResponsesApiConfiguredMock,
  requireCoworkerChatCapabilityMock,
  transactionMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemCreateMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  getResponseByIdMock: vi.fn(),
  isResponsesApiConfiguredMock: vi.fn(),
  requireCoworkerChatCapabilityMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/clients/coworker-api.client", () => ({
  extractTextFromCompletedOutput: (output: unknown) => {
    if (Array.isArray(output)) {
      const msg = output[0] as {
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
      if (msg?.type === "message" && Array.isArray(msg.content)) {
        return msg.content
          .filter((c) => (c as { type?: string }).type === "output_text")
          .map((c) => (c as { text?: string }).text ?? "")
          .join("");
      }
    }
    return "";
  },
  getResponseById: (...args: unknown[]) => getResponseByIdMock(...args),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    isResponsesApiConfigured: isResponsesApiConfiguredMock,
  };
});

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerChatCapability: requireCoworkerChatCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
      update: conversationUpdateMock,
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      transactionMock(fn) as Promise<unknown>,
  },
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });
    return await next();
  });

  mountPostRecoverResponse(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const CONV_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("POST /conversations/:id/recover-response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isResponsesApiConfiguredMock.mockReturnValue(true);
    requireCoworkerChatCapabilityMock.mockResolvedValue({
      id: "cow_123",
      slug: "ops-agent",
      baseURL: "https://api.example.com",
    });
    conversationItemCreateMock.mockResolvedValue(undefined);
    conversationUpdateMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          conversationItem: { create: conversationItemCreateMock },
          conversation: { update: conversationUpdateMock },
        }),
    );
  });

  it("returns 404 when conversation is not found", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(
      `http://localhost/${CONV_ID}/recover-response`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(getResponseByIdMock).not.toHaveBeenCalled();
  });

  it("returns 200 with recovered false when no pending response id", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: CONV_ID,
      metadata: {},
    });

    const app = createApp();
    const response = await app.request(
      `http://localhost/${CONV_ID}/recover-response`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ recovered: false });
    expect(getResponseByIdMock).not.toHaveBeenCalled();
  });

  it("returns 200 with recovered false when GET returns in progress", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: CONV_ID,
      metadata: {
        pending_responses_api_response_id: "resp_456",
        coworker_slug: "ops-agent",
      },
    });
    getResponseByIdMock.mockResolvedValueOnce({ status: "in_progress" });

    const app = createApp();
    const response = await app.request(
      `http://localhost/${CONV_ID}/recover-response`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ recovered: false });
    expect(getResponseByIdMock).toHaveBeenCalledWith("resp_456", {
      sokosumiUserId: "user_123",
      sokosumiOrganizationId: "org_123",
      coworkerSlug: "ops-agent",
    });
  });

  it("returns 200 with recovered true when GET returns completed", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: CONV_ID,
      metadata: {
        pending_responses_api_response_id: "resp_789",
        coworker_slug: "ops-agent",
      },
    });
    getResponseByIdMock.mockResolvedValueOnce({
      status: "completed",
      id: "resp_789",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Recovered message" }],
        },
      ],
    });

    const app = createApp();
    const response = await app.request(
      `http://localhost/${CONV_ID}/recover-response`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ recovered: true });
    expect(transactionMock).toHaveBeenCalled();
  });

  it("returns 400 when Responses API is not configured", async () => {
    isResponsesApiConfiguredMock.mockReturnValue(false);
    conversationFindFirstMock.mockResolvedValueOnce({
      id: CONV_ID,
      metadata: { pending_responses_api_response_id: "resp_1" },
    });

    const app = createApp();
    const response = await app.request(
      `http://localhost/${CONV_ID}/recover-response`,
      { method: "POST" },
    );

    expect(response.status).toBe(400);
  });

  it("resolves coworker slug from coworker_id when coworker_slug missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: CONV_ID,
      metadata: {
        pending_responses_api_response_id: "resp_2",
        coworker_id: "cow_123",
      },
    });
    getResponseByIdMock.mockResolvedValueOnce({ status: "in_progress" });

    const app = createApp();
    await app.request(`http://localhost/${CONV_ID}/recover-response`, {
      method: "POST",
    });

    expect(requireCoworkerChatCapabilityMock).toHaveBeenCalledWith("cow_123");
    expect(getResponseByIdMock).toHaveBeenCalledWith(
      "resp_2",
      expect.objectContaining({ coworkerSlug: "ops-agent" }),
    );
  });
});
