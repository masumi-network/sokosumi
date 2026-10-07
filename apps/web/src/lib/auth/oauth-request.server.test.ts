import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRedirectSearchParams } from "./auth.utils";
import { readOAuthRequest } from "./oauth-request.server";

const getSessionMock = vi.fn();
const getOAuthClientPublicPreloginMock = vi.fn();
const getOAuthClientPublicMock = vi.fn();

vi.mock("./auth.server", () => ({
  getSession: () => getSessionMock(),
  getOAuthClientPublic: (clientId: string) =>
    getOAuthClientPublicMock(clientId),
  getOAuthClientPublicPrelogin: (clientId: string, oauthQuery: string) =>
    getOAuthClientPublicPreloginMock(clientId, oauthQuery),
}));

// Core signs a request for ten minutes; the clock reads 10:00:00.
const NOW = Date.parse("2026-09-30T10:00:00Z");
const SIGNED = {
  client_id: "cmo",
  exp: String(NOW / 1000 + 600),
  sig: "signed-value",
};
const SIGNED_QUERY = `client_id=cmo&exp=${NOW / 1000 + 600}&sig=signed-value`;

const ACCOUNT = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
};

function signedInSince(createdAt: string) {
  return {
    session: { id: "session-1", createdAt },
    user: { ...ACCOUNT, emailVerified: true },
  };
}

function read(searchParams: AuthRedirectSearchParams) {
  return readOAuthRequest(Promise.resolve(searchParams));
}

describe("readOAuthRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue(null);
    getOAuthClientPublicPreloginMock.mockResolvedValue({
      client_name: "CMO",
      client_uri: "https://cmo.xyz",
      logo_uri: "https://cmo.xyz/logo.png",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds no request on a page without a signed OAuth query", async () => {
    expect(
      await read({ returnUrl: "/chat", client_id: "cmo" }),
    ).toBeUndefined();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
  });

  it("names the client and shows the form to a person who is not signed in", async () => {
    expect(await read({ ...SIGNED, email: "ada@example.com" })).toEqual({
      query: SIGNED_QUERY,
      client: {
        name: "CMO",
        uri: "https://cmo.xyz/",
        logoUri: "https://cmo.xyz/logo.png",
      },
      canHandBack: false,
      hasExpired: false,
    });
    expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledWith(
      "cmo",
      SIGNED_QUERY,
    );
  });

  it("hands a signed-in person back to the provider without asking", async () => {
    getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:00:00Z"));

    expect(await read(SIGNED)).toEqual({
      query: SIGNED_QUERY,
      client: {
        name: "CMO",
        uri: "https://cmo.xyz/",
        logoUri: "https://cmo.xyz/logo.png",
      },
      canHandBack: true,
      accountToConfirm: undefined,
      hasExpired: false,
    });
  });

  describe("when the request has expired", () => {
    const EXPIRED = { ...SIGNED, exp: String(NOW / 1000 - 60) };
    const EXPIRED_QUERY = `client_id=cmo&exp=${NOW / 1000 - 60}&sig=signed-value`;

    it("says so without the client to a person who is not signed in", async () => {
      expect(await read(EXPIRED)).toEqual({
        query: EXPIRED_QUERY,
        client: undefined,
        canHandBack: false,
        hasExpired: true,
      });
      // Core names a client only for a valid request or a session.
      expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
    });

    it("names the client to a signed-in person instead of handing it back", async () => {
      getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:00:00Z"));
      getOAuthClientPublicMock.mockResolvedValue(
        ok({
          client_name: "CMO",
          client_uri: "http://cmo.xyz",
          logo_uri: "https://cmo.xyz/logo.png",
        }),
      );

      expect(await read(EXPIRED)).toEqual({
        query: EXPIRED_QUERY,
        client: {
          name: "CMO",
          uri: undefined,
          logoUri: "https://cmo.xyz/logo.png",
        },
        canHandBack: false,
        hasExpired: true,
      });
      expect(getOAuthClientPublicMock).toHaveBeenCalledWith("cmo");
      expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    });

    it.each([
      ["cannot find it", ok(null)],
      ["is unavailable", err({ reason: "http", status: 503 })],
    ])(
      "leaves the client unnamed for a signed-in person when Core %s",
      async (_when, result) => {
        getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:00:00Z"));
        getOAuthClientPublicMock.mockResolvedValue(result);

        expect(await read(EXPIRED)).toMatchObject({
          client: undefined,
          hasExpired: true,
        });
      },
    );

    it("leaves a request that expired a moment ago to Core, whose clock may lag", async () => {
      expect(
        await read({ ...SIGNED, exp: String(NOW / 1000 - 5) }),
      ).toMatchObject({ hasExpired: false, client: { name: "CMO" } });
    });
  });

  it.each<AuthRedirectSearchParams>([
    { exp: "soon" },
    { exp: "0" },
    { exp: [String(NOW / 1000 - 60), String(NOW / 1000 + 600)] },
    { exp: [""] },
    { ba_param: ["ba_param", "client_id"] },
  ])(
    "leaves malformed expiry to Core instead of the named expired shortcut (%o)",
    async (extra) => {
      getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:00:00Z"));
      getOAuthClientPublicPreloginMock.mockResolvedValue(null);
      getOAuthClientPublicMock.mockResolvedValue(ok({ client_name: "CMO" }));

      expect(await read({ ...SIGNED, ...extra })).toMatchObject({
        hasExpired: false,
        client: undefined,
      });
      expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledOnce();
    },
  );

  it.each<AuthRedirectSearchParams>([
    { sig: [""] },
    { sig: ["signed-value", "second-signature"] },
    { client_id: ["cmo", "another-app"] },
    { ba_param: ["ba_param", "exp"] },
  ])(
    "keeps an expired malformed identity generic without client lookups (%o)",
    async (extra) => {
      getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:00:00Z"));
      getOAuthClientPublicMock.mockResolvedValue(ok({ client_name: "CMO" }));

      expect(
        await read({ ...SIGNED, exp: String(NOW / 1000 - 60), ...extra }),
      ).toMatchObject({
        hasExpired: true,
        client: undefined,
        canHandBack: false,
      });
      expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
      expect(getOAuthClientPublicPreloginMock).not.toHaveBeenCalled();
    },
  );

  it("leaves exactly thirty seconds past expiry to Core", async () => {
    expect(
      await read({ ...SIGNED, exp: String(NOW / 1000 - 30) }),
    ).toMatchObject({ hasExpired: false });
    expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledOnce();
    expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
  });

  describe("when the product asks for a new account", () => {
    // As Core signs it, at 10:00:00 (`ba_iat`, milliseconds).
    const CREATE = {
      ...SIGNED,
      prompt: "create",
      ba_iat: String(Date.parse("2026-09-30T10:00:00Z")),
    };

    // Core answers a session started for the request itself straight to the
    // product, so a session that reaches this page was there before.
    it.each([
      ["long before the request", "2026-09-30T09:00:00Z"],
      ["a moment before the request", "2026-09-30T09:59:59.700Z"],
      ["after the request", "2026-09-30T10:00:03Z"],
    ])(
      "asks a person signed in %s which account to use",
      async (_when, createdAt) => {
        getSessionMock.mockResolvedValue(signedInSince(createdAt));

        expect(await read(CREATE)).toMatchObject({
          canHandBack: true,
          accountToConfirm: ACCOUNT,
        });
      },
    );
  });

  it.each<Record<string, string>>([
    { prompt: "login" },
    { prompt: "login consent" },
    { max_age: "0" },
  ])(
    "keeps the form for a signed-in person when the request asks them to sign in again (%o)",
    async (extra) => {
      getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:00:00Z"));

      expect(await read({ ...SIGNED, ...extra })).toMatchObject({
        canHandBack: false,
      });
    },
  );

  it("leaves the client unnamed when Core cannot name it", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue(null);

    expect(await read(SIGNED)).toMatchObject({ client: undefined });
  });

  it("leaves the client unnamed when its row has no name", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue({
      client_uri: "https://cmo.xyz",
      logo_uri: "https://cmo.xyz/logo.png",
    });

    expect(await read(SIGNED)).toMatchObject({ client: undefined });
  });

  it("names the client without a link or logo its row does not carry", async () => {
    getOAuthClientPublicPreloginMock.mockResolvedValue({ client_name: "CMO" });

    expect(await read(SIGNED)).toMatchObject({
      client: { name: "CMO", uri: undefined, logoUri: undefined },
    });
  });

  it.each([
    "",
    "   ",
    "https%3A%2F%2Fcmo.xyz",
    "http://cmo.xyz",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//cmo.xyz",
    "not a url",
  ])("drops a client link and logo that are not https (%s)", async (value) => {
    getOAuthClientPublicPreloginMock.mockResolvedValue({
      client_name: "CMO",
      client_uri: value,
      logo_uri: value,
    });

    expect(await read(SIGNED)).toMatchObject({
      client: { name: "CMO", uri: undefined, logoUri: undefined },
    });
  });

  it.each([
    [" https://cmo.xyz/logo.png ", "https://cmo.xyz/logo.png"],
    ["https:logo.png", "https://logo.png/"],
    ["https:/logo.png", "https://logo.png/"],
    ["https://cmo.xyz/\nlogo.png", "https://cmo.xyz/logo.png"],
    ["https://cmo.xyz/a%20b.png", "https://cmo.xyz/a%20b.png"],
  ])(
    "normalizes HTTPS metadata before rendering (%s)",
    async (value, expected) => {
      getOAuthClientPublicPreloginMock.mockResolvedValue({
        client_name: "CMO",
        client_uri: value,
        logo_uri: value,
      });

      expect(await read(SIGNED)).toMatchObject({
        query: SIGNED_QUERY,
        client: { name: "CMO", uri: expected, logoUri: expected },
      });
    },
  );
});
