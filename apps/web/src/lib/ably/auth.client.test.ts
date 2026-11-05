import { Rest } from "ably";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AblyBrowserAuthError,
  fetchAblyBrowserAuthTokenRequest,
} from "./auth.client";
import { registerAblyChatRoomScope } from "./chat-room-auth-scope.client";

describe("fetchAblyBrowserAuthTokenRequest", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("aborts stalled browser auth requests so retries do not leave fetches running", async () => {
    const controller = new AbortController();
    const timeoutMock = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      if (!options.signal) {
        return Promise.reject(new Error("Missing abort signal"));
      }
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () =>
          reject(options.signal?.reason),
        );
      });
    });
    const request = fetchAblyBrowserAuthTokenRequest("inst_test01");
    const outcome = expect(request).rejects.toMatchObject({
      name: "TimeoutError",
    });
    controller.abort(
      new DOMException("Auth deadline exceeded", "TimeoutError"),
    );

    await outcome;
    expect(timeoutMock).toHaveBeenCalledWith(9_000);
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
      "/api/ably/auth?clientInstanceId=inst_test01&roomIds=",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
  });

  it("renews only mounted room grants and drops them after the last subscriber leaves", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ keyName: "app.key" }),
    });
    const release = registerAblyChatRoomScope(["room-b", "room-a"]);
    try {
      await fetchAblyBrowserAuthTokenRequest("inst_test01");
      expect(fetchMock.mock.lastCall?.[0]).toBe(
        "/api/ably/auth?clientInstanceId=inst_test01&roomIds=room-a%2Croom-b",
      );
    } finally {
      release();
    }
    await fetchAblyBrowserAuthTokenRequest("inst_test01");
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      "/api/ably/auth?clientInstanceId=inst_test01&roomIds=",
    );
  });

  // Pins ably-js behaviour, not ours: `Auth._ensureValidAuthCredentials`
  // discards an overtaken token response. The scope hook relies on it.
  it("keeps the newest room scope when earlier SDK authorizations settle late (ably-js contract)", async () => {
    const newCapability = '{"chat_rooms:room_room-b":["subscribe"]}';
    function tokenResponse(capability: string) {
      return Response.json({
        token: "opaque-token",
        issued: Date.now(),
        expires: Date.now() + 60_000,
        capability,
      });
    }
    let resolveBase: (response: Response) => void = () => undefined;
    let resolveOldRoom: (response: Response) => void = () => undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveBase = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOldRoom = resolve;
          }),
      )
      .mockImplementation(async () => tokenResponse(newCapability));
    let settledCallbackCount = 0;
    const client = new Rest({
      authCallback: (_params, callback) => {
        void fetchAblyBrowserAuthTokenRequest("inst_test01").then(
          (token) => {
            callback(null, token);
            settledCallbackCount += 1;
          },
          (error: unknown) => callback(String(error), null),
        );
      },
    });

    const baseAuthorization = client.auth.authorize();
    const releaseOldRoom = registerAblyChatRoomScope(["room-a"]);
    const oldRoomAuthorization = client.auth.authorize();
    releaseOldRoom();
    const releaseNewRoom = registerAblyChatRoomScope(["room-b"]);
    try {
      const newestToken = await client.auth.authorize();
      resolveOldRoom(tokenResponse('{"chat_rooms:room_room-a":["subscribe"]}'));
      resolveBase(tokenResponse("{}"));
      const earlierTokens = await Promise.all([
        baseAuthorization,
        oldRoomAuthorization,
      ]);
      await vi.waitFor(() => expect(settledCallbackCount).toBe(3));
      expect(
        [newestToken, ...earlierTokens].map((token) => token.capability),
      ).toEqual([newCapability, newCapability, newCapability]);
    } finally {
      releaseNewRoom();
    }
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
