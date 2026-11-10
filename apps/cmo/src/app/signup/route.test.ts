import { beforeEach, expect, it, vi } from "vitest";

const sokosumiSignInRedirect = vi.fn();

vi.mock("../../lib/auth", () => ({
  getAuth: () => ({}),
  sokosumiSignInRedirect,
}));

const { GET } = await import("./route");

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

it("carries the link's sign-up context to the website form", async () => {
  const response = await signup("?ref=partner&plan=pro");

  expect(response.headers.get("location")).toBe(
    "https://app.cmo.xyz/start?ref=partner&plan=pro",
  );
});

it("asks for the website when the link's is not one", async () => {
  const response = await signup("?url=not%20a%20site");

  expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
    "/start",
  );
});

// A link is a cross-site GET: it fills the form on return but starts nothing.
it("creates the account with a link's website, keeping nothing", async () => {
  const response = await signup("?url=acme.io&plan=pro");

  expect(sokosumiSignInRedirect).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Request),
    { createAccount: true },
  );
  expect(response.headers.get("location")).toBe(
    "https://core.example/authorize",
  );
  expect(response.headers.getSetCookie()).toEqual([]);
});
