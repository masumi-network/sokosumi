import { render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { PUBLIC_NEWSLETTER, PUBLIC_NEWSLETTER_SLUG } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ newsletter: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { getPublicNewsletter: mocks.newsletter },
}));
vi.mock("@/lib/actions/newsletter/signup", () => ({
  subscribeToNewsletter: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "PublicNewsletter.Signup",
    }),
}));

import SignupPage, { generateMetadata } from "./page";

const PROPS = { params: Promise.resolve({ slug: PUBLIC_NEWSLETTER_SLUG }) };
const BRANDED_NEWSLETTER = {
  ...PUBLIC_NEWSLETTER,
  brand: {
    ...PUBLIC_NEWSLETTER.brand,
    primaryColor: "#123456",
    accentColor: "#654321",
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.newsletter.mockResolvedValue(BRANDED_NEWSLETTER);
});

describe("hosted newsletter signup page", () => {
  it("renders public branding, the signup form and the archive link", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        {await SignupPage(PROPS)}
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Subscribe to Project news",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveStyle({
      borderTopColor: BRANDED_NEWSLETTER.brand.primaryColor,
      borderBottomColor: BRANDED_NEWSLETTER.brand.accentColor,
    });
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      PUBLIC_NEWSLETTER.brand.logoUrl,
    );
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse the archive" }),
    ).toHaveAttribute("href", `/n/${PUBLIC_NEWSLETTER_SLUG}/archive`);
    expect(screen.getAllByRole("button", { name: "Subscribe" })).toHaveLength(
      1,
    );
    expect(mocks.newsletter).toHaveBeenCalledWith(PUBLIC_NEWSLETTER_SLUG);
  });

  it("generates public sharing metadata", async () => {
    expect(await generateMetadata(PROPS)).toMatchObject({
      title: "Subscribe to Project news",
      description: en.PublicNewsletter.Signup.description,
      openGraph: {
        title: "Subscribe to Project news",
        type: "website",
        url: `https://app.sokosumi.com/n/${PUBLIC_NEWSLETTER_SLUG}`,
      },
    });
  });

  it("returns notFound for unknown slugs or disabled newsletters, including metadata", async () => {
    mocks.newsletter.mockResolvedValue(null);
    await expect(SignupPage(PROPS)).rejects.toThrow("NOT_FOUND");
    await expect(generateMetadata(PROPS)).rejects.toThrow("NOT_FOUND");
  });

  it("propagates Core outages", async () => {
    mocks.newsletter.mockRejectedValue(new Error("Core unavailable"));
    await expect(SignupPage(PROPS)).rejects.toThrow("Core unavailable");
    await expect(generateMetadata(PROPS)).rejects.toThrow("Core unavailable");
  });
});
