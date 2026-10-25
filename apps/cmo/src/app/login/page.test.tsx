import { beforeEach, expect, it, vi } from "vitest";

import { SignedOut } from "../../components/signed-out";

const getSession = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("../../lib/auth", () => ({
  getAuth: () => ({ api: { getSession } }),
}));

vi.mock("../actions", () => ({ createAccount: vi.fn(), signIn: vi.fn() }));

const { default: LoginPage, metadata } = await import("./page");

function render(error?: string | string[]) {
  return LoginPage({ searchParams: Promise.resolve({ error }) });
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
});

it("shows create account and sign in, with the error a sign in sent back", async () => {
  const page = await render("state_mismatch");

  expect(page.type).toBe(SignedOut);
  expect(page.props).toMatchObject({ error: "state_mismatch" });
});

it("does not show a gate error as a sign-in failure after signing out elsewhere", async () => {
  expect((await render("workspace_failed")).props).toMatchObject({
    error: undefined,
  });
});

it("sends a signed-in person home", async () => {
  getSession.mockResolvedValue({ user: { email: "ada@example.com" } });

  await expect(render()).rejects.toThrow("redirect /");
});

it("stays out of search while it is unlinked", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
