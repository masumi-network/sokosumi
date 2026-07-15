import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCoreAuthMock = vi.fn();

vi.mock("@/lib/auth/auth.server.client", () => ({
  fetchCoreAuth: (...args: unknown[]) => fetchCoreAuthMock(...args),
  getCoreAuthBaseUrl: () => "https://core.sokosumi.com/auth",
}));

import { proxyLegacyCoreAuthRequest } from "../legacy-core-auth-proxy.server";

describe("proxyLegacyCoreAuthRequest", () => {
  beforeEach(() => {
    fetchCoreAuthMock.mockReset();
  });

  it("forwards GET requests to Core auth with query params", async () => {
    fetchCoreAuthMock.mockResolvedValue(
      new Response(JSON.stringify({ session: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new NextRequest(
      "https://app.sokosumi.com/api/auth/get-session?disableCookieCache=true",
      { method: "GET" },
    );

    const response = await proxyLegacyCoreAuthRequest(request, ["get-session"]);

    expect(fetchCoreAuthMock).toHaveBeenCalledWith(
      "https://core.sokosumi.com/auth/get-session?disableCookieCache=true",
      {
        method: "GET",
        body: undefined,
        headers: undefined,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: null });
  });

  it("forwards POST bodies and propagates Set-Cookie headers", async () => {
    const coreHeaders = new Headers();
    coreHeaders.append(
      "set-cookie",
      "better-auth.session_token=abc; Path=/; HttpOnly",
    );

    fetchCoreAuthMock.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: coreHeaders,
      }),
    );

    const request = new NextRequest(
      "https://app.sokosumi.com/api/auth/passkey/generate-authenticate-options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    const response = await proxyLegacyCoreAuthRequest(request, [
      "passkey",
      "generate-authenticate-options",
    ]);

    expect(fetchCoreAuthMock).toHaveBeenCalledWith(
      "https://core.sokosumi.com/auth/passkey/generate-authenticate-options",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(response.status).toBe(200);
  });
});
