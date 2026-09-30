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

    expect(await read(SIGNED)).toMatchObject({ clientName: undefined });
  });
});
