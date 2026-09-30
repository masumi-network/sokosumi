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

function read(searchParams: Record<string, string>) {
  return readOAuthRequest(Promise.resolve(searchParams));
}

describe("readOAuthRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue(null);
    getOAuthClientPublicPreloginMock.mockResolvedValue({
      client_name: "CMO",
      client_uri: "https://cmo.xyz",
      logo_uri: "https://cmo.xyz/logo.png",
    });
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
        uri: "https://cmo.xyz",
        logoUri: "https://cmo.xyz/logo.png",
      },
      canHandBack: false,
    });
    expect(getOAuthClientPublicPreloginMock).toHaveBeenCalledWith(
      "cmo",
      SIGNED_QUERY,
    );
  });

  it("hands a signed-in person back to the provider", async () => {
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });

    expect(await read({ ...SIGNED, prompt: "create" })).toMatchObject({
      canHandBack: true,
    });
  });

  it.each<Record<string, string>>([
    { prompt: "login" },
    { prompt: "login consent" },
    { max_age: "0" },
  ])(
    "keeps the form for a signed-in person when the request asks them to sign in again (%o)",
    async (extra) => {
      getSessionMock.mockResolvedValue({ session: { id: "session-1" } });

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
});
