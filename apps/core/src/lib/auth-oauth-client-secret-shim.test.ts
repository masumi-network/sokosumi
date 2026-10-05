import { describe, expect, it, vi } from "vitest";

import { handleOAuthTokenRequest } from "./auth-oauth-provider";

const TOKEN_URL = "http://localhost:3001/auth/oauth2/token";

function formRequest(
  body: Record<string, string>,
  init?: { url?: string; method?: string; headers?: Record<string, string> },
): Request {
  return new Request(init?.url ?? TOKEN_URL, {
    method: init?.method ?? "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...init?.headers,
    },
    body: new URLSearchParams(body).toString(),
  });
}

// The request Better Auth's handler receives.
async function forwarded(request: Request): Promise<Request> {
  const handler = vi.fn(async (_request: Request) => new Response("{}"));
  await handleOAuthTokenRequest(request, handler, vi.fn(), vi.fn());
  expect(handler).toHaveBeenCalledOnce();
  return handler.mock.calls[0][0];
}

describe("client_secret_post shim", () => {
  it("moves a body client_secret into a Basic Authorization header", async () => {
    const result = await forwarded(
      formRequest({
        grant_type: "authorization_code",
        code: "code-1",
        client_id: "client-1",
        client_secret: "secret-1",
        code_verifier: "verifier-1",
      }),
    );

    const expected = Buffer.from("client-1:secret-1").toString("base64");
    expect(result.headers.get("authorization")).toBe(`Basic ${expected}`);
    const body = new URLSearchParams(await result.text());
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("code_verifier")).toBe("verifier-1");
  });

  it("retries a refresh without the secret it moved", async () => {
    const handler = vi.fn(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "invalid refresh token" },
        { status: 400 },
      ),
    );
    const retry = vi.fn(async () => Response.json({ access_token: "a" }));

    const response = await handleOAuthTokenRequest(
      formRequest({
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
        client_id: "client-1",
        client_secret: "secret-1",
      }),
      handler,
      retry,
      async () => true,
    );

    expect(response.status).toBe(200);
    const [body, request] = retry.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Request,
    ];
    expect(body).not.toHaveProperty("client_secret");
    expect(body).toMatchObject({ client_id: "client-1" });
    expect(request.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
    );
  });

  it("leaves requests with an existing Authorization header untouched", async () => {
    const request = formRequest(
      { client_id: "client-1", client_secret: "secret-1" },
      { headers: { authorization: "Basic already-there" } },
    );

    expect(await forwarded(request)).toBe(request);
  });

  it("leaves non-token paths untouched", async () => {
    const request = formRequest(
      { client_id: "client-1", client_secret: "secret-1" },
      { url: "http://localhost:3001/auth/oauth2/revoke" },
    );

    expect(await forwarded(request)).toBe(request);
  });

  it("leaves non-POST and non-form requests untouched", async () => {
    const get = new Request(TOKEN_URL, { method: "GET" });
    expect(await forwarded(get)).toBe(get);

    const json = new Request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "c", client_secret: "s" }),
    });
    expect(await forwarded(json)).toBe(json);
  });

  it("leaves requests without a body secret untouched", async () => {
    const request = formRequest({
      grant_type: "authorization_code",
      code: "code-1",
      client_id: "client-1",
      code_verifier: "verifier-1",
    });

    expect(await forwarded(request)).toBe(request);
  });
});
