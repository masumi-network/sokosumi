import { describe, expect, it } from "vitest";

import { withClientSecretPostShim } from "./oauth2-token-secret-shim";

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

describe("withClientSecretPostShim", () => {
  it("moves a body client_secret into a Basic Authorization header", async () => {
    const request = formRequest({
      grant_type: "authorization_code",
      code: "code-1",
      client_id: "client-1",
      client_secret: "secret-1",
      code_verifier: "verifier-1",
    });

    const result = await withClientSecretPostShim(request);

    const expected = Buffer.from("client-1:secret-1").toString("base64");
    expect(result.headers.get("authorization")).toBe(`Basic ${expected}`);
    const body = new URLSearchParams(await result.text());
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("code_verifier")).toBe("verifier-1");
  });

  it("leaves requests with an existing Authorization header untouched", async () => {
    const request = formRequest(
      { client_id: "client-1", client_secret: "secret-1" },
      { headers: { authorization: "Basic already-there" } },
    );

    const result = await withClientSecretPostShim(request);

    expect(result).toBe(request);
  });

  it("leaves non-token paths untouched", async () => {
    const request = formRequest(
      { client_id: "client-1", client_secret: "secret-1" },
      { url: "http://localhost:3001/auth/oauth2/revoke" },
    );

    const result = await withClientSecretPostShim(request);

    expect(result).toBe(request);
  });

  it("leaves non-POST and non-form requests untouched", async () => {
    const get = new Request(TOKEN_URL, { method: "GET" });
    expect(await withClientSecretPostShim(get)).toBe(get);

    const json = new Request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "c", client_secret: "s" }),
    });
    expect(await withClientSecretPostShim(json)).toBe(json);
  });

  it("leaves requests without a body secret untouched", async () => {
    const request = formRequest({
      grant_type: "authorization_code",
      code: "code-1",
      client_id: "client-1",
      code_verifier: "verifier-1",
    });

    const result = await withClientSecretPostShim(request);

    expect(result).toBe(request);
  });
});
