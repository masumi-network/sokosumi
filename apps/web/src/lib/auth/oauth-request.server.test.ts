import { beforeEach, describe, expect, it, vi } from "vitest";

import { readOAuthRequest } from "./oauth-request.server";

const getSessionMock = vi.fn();
const getOAuthClientPublicPreloginMock = vi.fn();

vi.mock("./auth.server", () => ({
  getSession: () => getSessionMock(),
  getOAuthClientPublicPrelogin: (clientId: string, oauthQuery: string) =>
    getOAuthClientPublicPreloginMock(clientId, oauthQuery),
}));

const SIGNED = {
  client_id: "cmo",
  exp: "1772367377",
  sig: "signed-value",
};
const SIGNED_QUERY = "client_id=cmo&exp=1772367377&sig=signed-value";

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

function read(searchParams: Record<string, string>) {
  return readOAuthRequest(Promise.resolve(searchParams));
}

describe("readOAuthRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue(null);
    getOAuthClientPublicPreloginMock.mockResolvedValue({ client_name: "CMO" });
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
      clientName: "CMO",
      canHandBack: false,
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
      clientName: "CMO",
      canHandBack: true,
      accountToConfirm: undefined,
    });
  });

  describe("when the product asks for a new account", () => {
    // Core signed the request (`ba_iat`, milliseconds) at 10:00:00.
    const CREATE = {
      ...SIGNED,
      prompt: "create",
      ba_iat: String(Date.parse("2026-09-30T10:00:00Z")),
    };

    it("asks a person signed in before the request which account to use", async () => {
      getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:59:54Z"));

      expect(await read(CREATE)).toMatchObject({
        canHandBack: true,
        accountToConfirm: ACCOUNT,
      });
    });

    it("asks when the request does not say when it was signed", async () => {
      getSessionMock.mockResolvedValue(signedInSince("2026-09-30T09:59:59Z"));

      expect(await read({ ...SIGNED, prompt: "create" })).toMatchObject({
        accountToConfirm: ACCOUNT,
      });
    });

    it.each([
      ["in the response that signed it", "2026-09-30T09:59:59.700Z"],
      ["five seconds before it was signed", "2026-09-30T09:59:55Z"],
      ["after it was signed", "2026-09-30T10:00:03Z"],
    ])(
      "does not ask a person whose session started %s",
      async (_when, createdAt) => {
        getSessionMock.mockResolvedValue(signedInSince(createdAt));

        expect(await read(CREATE)).toMatchObject({
          canHandBack: true,
          accountToConfirm: undefined,
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

    expect(await read(SIGNED)).toMatchObject({ clientName: undefined });
  });
});
