import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import { PUBLIC_NEWSLETTER_SLUG } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), locale: vi.fn() }));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { subscribe: mocks.subscribe },
}));
vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await import("@/lib/clients/core.request");
  return { CoreApiRequestError };
});
vi.mock("next-intl/server", () => ({
  getLocale: mocks.locale,
  getTranslations: async () =>
    createTranslator({
      locale: mocks.locale(),
      messages: mocks.locale() === "de" ? de : en,
      namespace: "PublicNewsletter.Signup",
    }),
}));

import { subscribeToNewsletter } from "./signup";

const INPUT = {
  slug: PUBLIC_NEWSLETTER_SLUG,
  values: {
    email: "  READER@Example.com  ",
    name: "  Ada  ",
    consent: true,
    website: "",
  },
};
const ACCEPTED = { status: "check_your_inbox" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.locale.mockReturnValue("en");
  mocks.subscribe.mockResolvedValue(ACCEPTED);
});

describe("public newsletter signup action", () => {
  it("subscribes without a session using normalized email, optional name, source and request locale", async () => {
    mocks.locale.mockReturnValue("de");
    expect(await subscribeToNewsletter(INPUT)).toEqual({
      ok: true,
      value: ACCEPTED,
    });
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith(INPUT.slug, {
      email: "reader@example.com",
      name: "Ada",
      website: "",
      source: "SIGNUP_FORM",
      locale: "de",
    });
  });

  it("accepts an omitted name and falls back to a supported email locale", async () => {
    mocks.locale.mockReturnValue("fr");
    await subscribeToNewsletter({
      ...INPUT,
      values: { email: "reader@example.com", consent: true },
    });
    expect(mocks.subscribe).toHaveBeenCalledWith(INPUT.slug, {
      email: "reader@example.com",
      name: undefined,
      website: undefined,
      source: "SIGNUP_FORM",
      locale: "en",
    });
  });

  it.each([
    { email: "not-an-email", consent: true },
    { email: "reader@example.com", consent: false },
    { email: "reader@example.com" },
    { email: "reader@example.com", consent: true, name: "a".repeat(201) },
    { email: "reader@example.com", consent: true, website: "a".repeat(2049) },
    null,
  ])("rejects invalid input before Core access: %j", async (values) => {
    const result = await subscribeToNewsletter({ ...INPUT, values });
    expect(result).toMatchObject({
      ok: false,
      error: { message: en.PublicNewsletter.Signup.invalid },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it.each(["", "a".repeat(301)])("rejects invalid slugs", async (slug) => {
    expect(await subscribeToNewsletter({ ...INPUT, slug })).toEqual({
      ok: false,
      error: { message: en.PublicNewsletter.Signup.unavailable },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("forwards honeypots and preserves Core's generic acknowledgment", async () => {
    expect(
      await subscribeToNewsletter({
        ...INPUT,
        values: { ...INPUT.values, website: "https://spam.example" },
      }),
    ).toEqual({ ok: true, value: ACCEPTED });
    expect(mocks.subscribe).toHaveBeenCalledWith(
      INPUT.slug,
      expect.objectContaining({ website: "https://spam.example" }),
    );
  });

  it.each([
    [429, en.PublicNewsletter.Signup.rateLimit],
    [404, en.PublicNewsletter.Signup.unavailable],
    [503, en.PublicNewsletter.Signup.error],
  ])("maps Core %s to a friendly error", async (status, message) => {
    mocks.subscribe.mockRejectedValue(
      new CoreApiRequestError("Private Core details", { status }),
    );
    expect(await subscribeToNewsletter(INPUT)).toEqual({
      ok: false,
      error: { message },
    });
  });

  it("returns a localized field error for Core email rejection", async () => {
    mocks.locale.mockReturnValue("de");
    mocks.subscribe.mockRejectedValue(
      new CoreApiRequestError("Invalid", { status: 422 }),
    );
    expect(await subscribeToNewsletter(INPUT)).toEqual({
      ok: false,
      error: {
        message: de.PublicNewsletter.Signup.invalidEmail,
        fieldErrors: { email: [de.PublicNewsletter.Signup.invalidEmail] },
      },
    });
  });

  it("handles unexpected failures without exposing internal errors", async () => {
    mocks.subscribe.mockRejectedValue(new Error("Private network details"));
    expect(await subscribeToNewsletter(INPUT)).toEqual({
      ok: false,
      error: { message: en.PublicNewsletter.Signup.error },
    });
  });
});
