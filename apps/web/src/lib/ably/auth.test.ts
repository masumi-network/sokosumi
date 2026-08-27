import { beforeEach, describe, expect, it, vi } from "vitest";

const { headersMock, getCoreApiBaseUrlMock, fetchMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  getCoreApiBaseUrlMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getCoreApiBaseUrl: (...args: unknown[]) => getCoreApiBaseUrlMock(...args),
}));

import createAuthTokenRequest from "./auth";

describe("createAuthTokenRequest", () => {
  beforeEach(() => {
    headersMock.mockReset();
    getCoreApiBaseUrlMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // Real getCoreApiBaseUrl() always includes the /v1 suffix.
    getCoreApiBaseUrlMock.mockReturnValue("http://core.test/v1");
    headersMock.mockResolvedValue(new Headers({ cookie: "session=abc" }));
  });

  it("unwraps Core { data } so Ably receives a raw TokenRequest", async () => {
    const tokenRequest = {
      keyName: "app.key",
      capability: '{"chat_rooms:room_a":["subscribe"]}',
      timestamp: 1_700_000_000_000,
      nonce: "n1",
      mac: "m1",
      clientId: "user_123",
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: tokenRequest,
        meta: { timestamp: "2026-08-06T00:00:00.000Z", requestId: "req" },
      }),
    });

    const result = await createAuthTokenRequest({
      clientInstanceId: "inst_test01",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining(
          "http://core.test/v1/realtime/ably-token",
        ),
      }),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          cookie: "session=abc",
          Accept: "application/json",
        }),
      }),
    );
    const fetchUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(fetchUrl.searchParams.get("clientInstanceId")).toBe("inst_test01");
    expect(result).toEqual(tokenRequest);
    // Must not return the Core envelope — Ably authUrl expects TokenRequest fields.
    expect(result).not.toHaveProperty("meta");
    expect(result).not.toHaveProperty("data");
  });

  it("throws when Core returns a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    await expect(createAuthTokenRequest()).rejects.toThrow(
      /Core Ably token mint failed \(401\)/,
    );
  });

  it("throws when Core omits data", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ meta: {} }),
    });

    await expect(createAuthTokenRequest()).rejects.toThrow(/empty payload/);
  });
});
