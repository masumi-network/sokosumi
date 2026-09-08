import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AblyBrowserAuthError,
  fetchAblyBrowserAuthTokenRequest,
} from "./auth.client";

describe("fetchAblyBrowserAuthTokenRequest", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("POSTs to /api/ably/auth with cookies and clientInstanceId", async () => {
    const tokenRequest = {
      keyName: "app.key",
      capability: "{}",
      timestamp: 1,
      nonce: "n",
      mac: "m",
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => tokenRequest,
    });

    await expect(
      fetchAblyBrowserAuthTokenRequest("inst_test01"),
    ).resolves.toEqual(tokenRequest);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ably/auth?clientInstanceId=inst_test01",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
  });

  it("throws a 401 AblyBrowserAuthError when the session is gone", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    });

    const error = await fetchAblyBrowserAuthTokenRequest("inst_test01").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AblyBrowserAuthError);
    expect(error).toMatchObject({
      status: 401,
      message: "Ably auth failed: session is gone",
    });
  });

  it("throws a 502 AblyBrowserAuthError when Core minting fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '{"error":"Failed to create Ably token"}',
    });

    const error = await fetchAblyBrowserAuthTokenRequest("inst_test01").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AblyBrowserAuthError);
    expect(error).toMatchObject({
      status: 502,
    });
    expect((error as AblyBrowserAuthError).message).toMatch(/502/);
  });
});
