import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, TestSsrfError } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  TestSsrfError: class TestSsrfError extends Error {},
}));

// The conversation call goes through the SSRF-guarded client (the base URL is
// vendor-supplied), so the mock has to sit there rather than on global fetch.
vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: fetchMock,
  SsrfError: TestSsrfError,
}));

import {
  COWORKER_CHAT_BILLING_MESSAGE,
  CoworkerConversationError,
  createCoworkerConversation,
  throwCoworkerRemoteConversationHttpError,
} from "./coworker-conversation";

const DEFAULT_BASE_URL = "https://api.coworker.example.com/v1";

describe("coworker-conversation", () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when responsesApiBaseUrl is missing", async () => {
    fetchMock.mockClear();
    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: "",
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toThrow("Responses API base URL is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs /conversations with metadata and Sokosumi identity headers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "conv_remote_1" }),
    });

    const result = await createCoworkerConversation({
      responsesApiBaseUrl: DEFAULT_BASE_URL,
      sokosumiUserId: "user_1",
      sokosumiOrganizationId: "org_1",
      coworkerSlug: "ops-agent",
      sokosumiConversationId: "conv-local-1",
    });

    expect(result).toEqual({ id: "conv_remote_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/conversations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Sokosumi-User-Id": "user_1",
          "X-Coworker-Slug": "ops-agent",
          "X-Sokosumi-Organization-Id": "org_1",
        }),
      }),
    );
    const [, initWithOrg] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(initWithOrg.headers["X-Sokosumi-User-Id"]).toBe("user_1");
    expect(initWithOrg.headers["X-Sokosumi-Organization-Id"]).toBe("org_1");
    expect(JSON.parse(initWithOrg.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        sokosumi_organization_id: "org_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("accepts id nested under data in JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "conv_nested" } }),
    });

    const result = await createCoworkerConversation({
      responsesApiBaseUrl: DEFAULT_BASE_URL,
      sokosumiUserId: "user_1",
      sokosumiOrganizationId: null,
      coworkerSlug: "ops-agent",
      sokosumiConversationId: "conv-local-1",
    });

    expect(result).toEqual({ id: "conv_nested" });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(init.headers["X-Sokosumi-User-Id"]).toBe("user_1");
    expect(init.headers["X-Sokosumi-Organization-Id"]).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("throws CoworkerConversationError with billing_required on OpenAI 403", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: {
            message: "Account setup or billing required",
            type: "invalid_request_error",
            code: "billing_required",
          },
        }),
    });

    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toMatchObject({
      name: "CoworkerConversationError",
      upstreamStatus: 403,
      upstreamCode: "billing_required",
    });
  });
});

describe("throwCoworkerRemoteConversationHttpError", () => {
  it("surfaces an outbound-guard rejection distinctly from a transport failure", async () => {
    fetchMock.mockRejectedValueOnce(
      new TestSsrfError("Host resolves to blocked address 169.254.169.254"),
    );

    // A blocked address or an oversized body is operator-actionable; folding it
    // into a generic 503 would hide a misconfigured or hostile endpoint.
    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: "https://cow.example/v1",
        sokosumiUserId: "user-1",
        sokosumiOrganizationId: null,
        coworkerSlug: "agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toMatchObject({
      name: "CoworkerConversationError",
      upstreamStatus: 502,
      upstreamCode: "coworker_endpoint_rejected",
    });
  });

  it("maps billing_required to 403 with a user-facing message", () => {
    expect(() =>
      throwCoworkerRemoteConversationHttpError(
        new CoworkerConversationError(
          "Conversations API request failed",
          403,
          "billing_required",
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 403,
        message: COWORKER_CHAT_BILLING_MESSAGE,
      }),
    );
  });

  it("maps unexpected upstream 5xx to 503 without reporting to Sentry", () => {
    expect(() =>
      throwCoworkerRemoteConversationHttpError(
        new CoworkerConversationError("Conversations API request failed", 502),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 503,
        cause: expect.objectContaining({ reportToSentry: false }),
      }),
    );
  });
});
