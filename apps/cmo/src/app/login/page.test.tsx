import { beforeEach, expect, it, vi } from "vitest";

import { SignInProblem } from "../../components/sign-in-problem";

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

vi.mock("../actions", () => ({ signIn: vi.fn() }));

const { default: LoginPage, metadata } = await import("./page");

function render(error?: string | string[]) {
  return LoginPage({ searchParams: Promise.resolve({ error }) });
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
});

it("shows the error a sign in sent back", async () => {
  const page = await render("state_mismatch");

  expect(page.type).toBe(SignInProblem);
  expect(page.props).toMatchObject({ error: "state_mismatch" });
});

it("goes straight on to Sokosumi's Log in without an error", async () => {
  await expect(render()).rejects.toThrow("redirect /signin");
});

it("sends a signed-in person home", async () => {
  getSession.mockResolvedValue({ user: { email: "ada@example.com" } });

  await expect(render("state_mismatch")).rejects.toThrow("redirect /");
});

it("stays out of search while it is unlinked", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
