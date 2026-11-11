import { beforeEach, expect, it, vi } from "vitest";

import { SignInProblem } from "../../components/sign-in-problem";
import { CMO_SIGN_IN_ERROR } from "../../lib/sign-in-errors";

const getSession = vi.fn();

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("../../lib/auth", () => ({
  getAuth: () => ({ api: { getSession } }),
}));

const signIn = vi.fn();
const createAccountAgain = vi.fn();
vi.mock("../actions", () => ({ signIn, createAccountAgain }));

const { default: LoginPage, metadata } = await import("./page");

function render(error?: string | string[]) {
  return LoginPage({ searchParams: Promise.resolve({ error }) });
}

beforeEach(() => {
  cookieJar.clear();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
});

it("shows the error a sign in sent back", async () => {
  const page = await render("state_mismatch");

  expect(page.type).toBe(SignInProblem);
  expect(page.props).toMatchObject({ error: "state_mismatch", signIn });
});

it("says the website typed before a failed sign in is kept", async () => {
  cookieJar.set("cmo-website", "https://acme.io/");

  const page = await render("access_denied");

  expect(page.props).toMatchObject({
    error: "access_denied",
    website: "acme.io",
  });
});

it("goes straight on to Sokosumi's Log in without an error", async () => {
  await expect(render()).rejects.toThrow("redirect /signin");
});

it("sends a signed-in person home", async () => {
  getSession.mockResolvedValue({ user: { email: "ada@example.com" } });

  await expect(render("state_mismatch")).rejects.toThrow("redirect /");
});

it("asks a person Core no longer accepts to sign in again", async () => {
  getSession.mockResolvedValue({ user: { email: "ada@example.com" } });

  const page = await render(CMO_SIGN_IN_ERROR.signedOut);

  expect(page.type).toBe(SignInProblem);
  expect(page.props).toMatchObject({ error: CMO_SIGN_IN_ERROR.signedOut });
});

it("stays out of search while it is unlinked", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
