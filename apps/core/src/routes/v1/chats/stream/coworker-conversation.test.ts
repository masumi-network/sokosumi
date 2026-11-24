import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { createLocalJWKSet, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jwtKeyStoreOptions } from "@/lib/auth-oauth-provider";

const { fetchMock, authState } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  authState: {
    current: null as ReturnType<typeof createTestAuth> | null,
    shouldFail: false,
  },
}));

vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: fetchMock }));
vi.mock("@/lib/auth", () => ({
  get auth() {
    if (authState.shouldFail) {
      return {
        get $context() {
          return Promise.reject(new Error("JWKS unavailable"));
        },
      };
    }
    return authState.current!;
  },
}));

import { internalServerError } from "@/helpers/error";
import {
  COWORKER_CHAT_BILLING_MESSAGE,
  CoworkerConversationError,
  createCoworkerConversation,
  throwCoworkerRemoteConversationHttpError,
} from "./coworker-conversation";

const DEFAULT_BASE_URL = "https://api.coworker.example.com/v1";

function createTestAuth() {
  return betterAuth({
    baseURL: "https://api.sokosumi.com",
    basePath: "/auth",
    secret: "coworker-conversation-test-secret-long-enough-32",
    database: memoryAdapter({ jwks: [] }),
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        ...jwtKeyStoreOptions(false),
      }),
      oauthProvider({
        loginPage: "https://app.sokosumi.com/signin",
        consentPage: "https://app.sokosumi.com/oauth/consent",
      }),
    ],
  });
}

async function verifyBearerHeader(authorization: string | undefined) {
  expect(authorization).toMatch(/^Bearer /);
  const token = (authorization ?? "").slice("Bearer ".length);
  const jwks = await authState.current!.api.getJwks();
  return jwtVerify(token, createLocalJWKSet(jwks), {
    issuer: "https://api.sokosumi.com/auth",
    audience: DEFAULT_BASE_URL,
    typ: "coworker+jwt",
  });
}

describe("coworker-conversation", () => {
  beforeEach(() => {
    authState.shouldFail = false;
    authState.current = createTestAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unsafe coworker fetch is forbidden");
      }),
    );
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
    ).rejects.toMatchObject({
      status: 500,
      message: "Responses API base URL is required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs /conversations with a verified Bearer token, metadata, and Sokosumi identity headers", async () => {
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
        redirect: "manual",
        maxResponseBytes: 1024 * 1024,
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
          "Content-Type": "application/json",
          "Accept-Encoding": "identity",
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
    const verified = await verifyBearerHeader(
      initWithOrg.headers.Authorization,
    );
    expect(verified.payload.sub).toBe("user_1");
    expect(verified.payload.org).toBe("org_1");
    expect(verified.payload.coworker).toBe("ops-agent");
    expect(JSON.parse(initWithOrg.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        sokosumi_organization_id: "org_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("accepts id nested under data in JSON body and omits org in personal chats", async () => {
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
    const verified = await verifyBearerHeader(init.headers.Authorization);
    expect(verified.payload.sub).toBe("user_1");
    expect("org" in verified.payload).toBe(false);
    expect(verified.payload.coworker).toBe("ops-agent");
    expect(JSON.parse(init.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("fails without calling fetch when token signing fails", async () => {
    authState.shouldFail = true;

    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toThrow("JWKS unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 3xx redirect as a failed conversation create without following", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      text: async () => "",
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
      upstreamStatus: 302,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/conversations",
      expect.objectContaining({ redirect: "manual" }),
    );
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
  it("rethrows HTTPException from createCoworkerConversation", () => {
    expect(() =>
      throwCoworkerRemoteConversationHttpError(
        internalServerError("Responses API base URL is required"),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 500,
        message: "Responses API base URL is required",
      }),
    );
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
