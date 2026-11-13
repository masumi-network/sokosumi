import { beforeEach, expect, it, vi } from "vitest";

import { Onboarding } from "../../components/onboarding";

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

const continueWithWebsite = vi.fn();
vi.mock("../actions", () => ({ continueWithWebsite }));

const { default: StartPage, metadata } = await import("./page");

const render = (query: Record<string, string | string[]> = {}) =>
  StartPage({ searchParams: Promise.resolve(query) });

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  cookieJar.clear();
});

it("asks a signed-out founder for the website before sign in", async () => {
  const page = await render();

  expect(page.type).toBe(Onboarding);
  expect(page.props).toMatchObject({
    signedOut: true,
    onboard: continueWithWebsite,
  });
  expect(page.props.websiteUrl).toBeUndefined();
});

it("fills the field with the website kept from an earlier try", async () => {
  cookieJar.set("cmo-website", "https://acme.io/");

  const page = await render();

  expect(page.props.websiteUrl).toBe("acme.io");
});

it("carries a Create account link's parameters, but not its website", async () => {
  const page = await render({
    ref: ["partner", "other"],
    url: "bad",
    plan: "pro",
  });

  expect(page.props.signUpContext).toEqual({ ref: "partner", plan: "pro" });
});

it("sends a signed-in person home", async () => {
  getSession.mockResolvedValue({ user: { email: "ada@example.com" } });

  await expect(render()).rejects.toThrow("redirect /");
});

it("stays out of search while it is unlinked", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
