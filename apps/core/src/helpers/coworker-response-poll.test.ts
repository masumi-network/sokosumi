import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { createLocalJWKSet, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jwtKeyStoreOptions } from "@/lib/auth-oauth-provider";

const { fetchMock, safeFetchMock, authState } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  safeFetchMock: vi.fn(),
  authState: {
    current: null as ReturnType<typeof createTestAuth> | null,
    shouldFail: false,
  },
}));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: safeFetchMock }));
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

import {
  coworkerResponseText,
  pollCoworkerResponseStatus,
  retrieveCoworkerResponse,
} from "./coworker-response-poll";

function createTestAuth() {
  return betterAuth({
    baseURL: "https://api.sokosumi.com",
    basePath: "/auth",
    secret: "coworker-response-poll-test-secret-long-enough-32",
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

async function verifyBearerFromInit(
  init: RequestInit | undefined,
  expectedAudience: string,
) {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  expect(headers.Authorization).toMatch(/^Bearer /);
  const token = headers.Authorization.slice("Bearer ".length);
  const jwks = await authState.current!.api.getJwks();
  const { payload, protectedHeader } = await jwtVerify(
    token,
    createLocalJWKSet(jwks),
    {
      issuer: "https://api.sokosumi.com/auth",
      audience: expectedAudience,
      typ: "coworker+jwt",
    },
  );
  return { payload, protectedHeader };
}

const DEFAULT_PARAMS = {
  responsesApiBaseUrl: "https://api.coworker.example.com/v1",
  responseId: "resp_pending",
  userId: "user_1",
  organizationId: "org_1",
  coworkerSlug: "elena",
  fetchFn: fetchMock,
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 40,
};

function jsonResponse(status: string, httpStatus = 200): Response {
  return new Response(JSON.stringify({ id: "resp_pending", status }), {
    status: httpStatus,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pollCoworkerResponseStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    authState.shouldFail = false;
    authState.current = createTestAuth();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retrieves with coworker headers and a verified Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("completed"));

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result).toEqual({
      status: "completed",
      responseId: "resp_pending",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/responses/resp_pending",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        maxResponseBytes: 16 * 1024 * 1024,
        headers: {
          Authorization: expect.stringMatching(/^Bearer /),
          "Accept-Encoding": "identity",
          "X-Sokosumi-User-Id": "user_1",
          "X-Coworker-Slug": "elena",
          "X-Sokosumi-Organization-Id": "org_1",
        },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { payload } = await verifyBearerFromInit(
      init,
      "https://api.coworker.example.com/v1",
    );
    expect(payload.sub).toBe("user_1");
    expect(payload.org).toBe("org_1");
    expect(payload.coworker).toBe("elena");
  });

  it("polls in_progress until a terminal status with a fresh jti on each poll", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse("in_progress"))
      .mockResolvedValueOnce(jsonResponse("completed"));

    const result = await pollCoworkerResponseStatus({
      ...DEFAULT_PARAMS,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = await verifyBearerFromInit(
      fetchMock.mock.calls[0]![1] as RequestInit,
      "https://api.coworker.example.com/v1",
    );
    const second = await verifyBearerFromInit(
      fetchMock.mock.calls[1]![1] as RequestInit,
      "https://api.coworker.example.com/v1",
    );
    expect(first.payload.jti).toBeTruthy();
    expect(second.payload.jti).toBeTruthy();
    expect(first.payload.jti).not.toBe(second.payload.jti);
  });

  it("omits org in the token and X-Sokosumi-Organization-Id in a personal chat", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("completed"));

    const result = await pollCoworkerResponseStatus({
      ...DEFAULT_PARAMS,
      organizationId: null,
    });

    expect(result.status).toBe("completed");
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers["X-Sokosumi-Organization-Id"]).toBeUndefined();
    const { payload } = await verifyBearerFromInit(
      init,
      "https://api.coworker.example.com/v1",
    );
    expect("org" in payload).toBe(false);
  });

  it("fails the poll without calling fetch when signing fails", async () => {
    authState.shouldFail = true;

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.cause).toBeInstanceOf(Error);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 3xx redirect as a failed poll without following", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "https://other.example.com/steal" },
      }),
    );

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result).toMatchObject({
      status: "error",
      responseId: "resp_pending",
      httpStatus: 302,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/responses/resp_pending",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("returns failed when coworker reports failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("failed"));

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result).toEqual({
      status: "failed",
      responseId: "resp_pending",
    });
  });

  it("returns error on HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("completed", 503));

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.responseId).toBe("resp_pending");
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it("returns in_progress when max attempts are exhausted", async () => {
    fetchMock.mockImplementation(() => jsonResponse("in_progress"));

    const result = await pollCoworkerResponseStatus({
      ...DEFAULT_PARAMS,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(result).toEqual({
      status: "in_progress",
      responseId: "resp_pending",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("coworkerResponseText", () => {
  it("prefers output_text and falls back to assistant message parts", () => {
    expect(coworkerResponseText({ output_text: " Done. " })).toBe("Done.");
    expect(
      coworkerResponseText({
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "private" }],
          },
          {
            type: "message",
            content: [
              { type: "output_text", text: "PR " },
              { type: "output_text", text: "merged." },
            ],
          },
        ],
      }),
    ).toBe("PR merged.");
    expect(coworkerResponseText({ output: [] })).toBeNull();
    expect(coworkerResponseText(null)).toBeNull();
  });
});

describe("retrieveCoworkerResponse", () => {
  beforeEach(() => {
    authState.shouldFail = false;
    authState.current = createTestAuth();
  });

  it("returns the status and final text of a finished response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_1",
          status: "completed",
          output_text: "Merged.",
        }),
        { status: 200 },
      ),
    );

    const retrieved = await retrieveCoworkerResponse({
      ...DEFAULT_PARAMS,
      responseId: "resp_1",
      fetchFn,
    });

    expect(retrieved).toEqual({
      result: { status: "completed", responseId: "resp_1" },
      text: "Merged.",
    });
  });
});

describe("retrieveCoworkerResponse errors", () => {
  beforeEach(() => {
    authState.shouldFail = false;
    authState.current = createTestAuth();
  });

  it("reports the HTTP status of a failed retrieve", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("not found", { status: 404 }));

    const retrieved = await retrieveCoworkerResponse({
      ...DEFAULT_PARAMS,
      fetchFn,
    });

    expect(retrieved.result).toMatchObject({
      status: "error",
      httpStatus: 404,
    });
    expect(retrieved.text).toBeNull();
  });
});

describe("retrieveCoworkerResponse default transport", () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
    authState.shouldFail = false;
    authState.current = createTestAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unsafe coworker fetch is forbidden");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses bounded SSRF-safe transport when no test fetch is supplied", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse("completed"));
    const { fetchFn: _fetchFn, ...params } = DEFAULT_PARAMS;
    const retrieved = await retrieveCoworkerResponse(params);
    expect(retrieved.result.status).toBe("completed");
    expect(safeFetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/responses/resp_pending",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        maxResponseBytes: 16 * 1024 * 1024,
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
          "Accept-Encoding": "identity",
          "X-Sokosumi-User-Id": "user_1",
          "X-Coworker-Slug": "elena",
        }),
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
