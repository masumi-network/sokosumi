import { beforeEach, expect, it, vi } from "vitest";

const sokosumiSignInRedirect = vi.fn();

vi.mock("../../lib/auth", () => ({
  getAuth: () => ({}),
  sokosumiSignInRedirect,
}));

const { GET } = await import("./route");
const { KEPT_WEBSITE_COOKIE } = await import("../../lib/kept-website");

const signup = (query = "") =>
  GET(new Request(`https://app.cmo.xyz/signup${query}`));

beforeEach(() => {
  sokosumiSignInRedirect.mockReset();
  sokosumiSignInRedirect.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://core.example/authorize" },
    }),
  );
});

it("asks for the website first when the link carries none", async () => {
  const response = await signup();

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://app.cmo.xyz/start");
  expect(sokosumiSignInRedirect).not.toHaveBeenCalled();
});

it("keeps the website a link carries, then creates the account", async () => {
  const response = await signup("?url=acme.io&plan=pro");

  expect(sokosumiSignInRedirect).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Request),
    { createAccount: true },
  );
  expect(response.headers.get("location")).toBe(
    "https://core.example/authorize",
  );
  expect(response.headers.getSetCookie()).toEqual([
    expect.stringMatching(
      new RegExp(`^${KEPT_WEBSITE_COOKIE}=https%3A%2F%2Facme.io%2F;.*HttpOnly`),
    ),
  ]);
});

// Home starts reading it for a person not hired yet; hiring clears it.
it("keeps the website for a person already signed in too", async () => {
  sokosumiSignInRedirect.mockResolvedValue(
    new Response(null, { status: 302, headers: { location: "/" } }),
  );

  const response = await signup("?url=acme.io");

  expect(response.headers.get("location")).toBe("/");
  expect(response.headers.getSetCookie()).toHaveLength(1);
});

it("asks for the website when the link's is not one", async () => {
  const response = await signup("?url=not%20a%20site");

  expect(response.headers.get("location")).toBe("https://app.cmo.xyz/start");
});
