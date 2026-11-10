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

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  cookieJar.clear();
});

it("asks a signed-out founder for the website before sign in", async () => {
  const page = await StartPage();

  expect(page.type).toBe(Onboarding);
  expect(page.props).toMatchObject({
    signedOut: true,
    onboard: continueWithWebsite,
  });
  expect(page.props.websiteUrl).toBeUndefined();
});

it("fills the field with the website kept from an earlier try", async () => {
  cookieJar.set("cmo-website", "https://acme.io/");

  const page = await StartPage();

  expect(page.props.websiteUrl).toBe("acme.io");
});

it("sends a signed-in person home", async () => {
  getSession.mockResolvedValue({ user: { email: "ada@example.com" } });

  await expect(StartPage()).rejects.toThrow("redirect /");
});

it("stays out of search while it is unlinked", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
