import { readFileSync } from "node:fs";
import { join } from "node:path";
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

import EmbedPage, { generateMetadata } from "./page";

const PROPS = { params: Promise.resolve({ slug: PUBLIC_NEWSLETTER_SLUG }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.newsletter.mockResolvedValue(PUBLIC_NEWSLETTER);
});

describe("newsletter signup embed", () => {
  it("renders the shared form with the newsletter name and compact chrome", async () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        {await EmbedPage(PROPS)}
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: PUBLIC_NEWSLETTER.name }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Name (optional)")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: en.PublicNewsletter.Signup.consent,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-newsletter-embed]"),
    ).toBeInTheDocument();
  });

  it("keeps an opaque theme background so dark-mode text stays readable on any host site", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/n/[slug]/embed/embed.css"),
      "utf8",
    );
    expect(css).not.toMatch(/background\s*:\s*transparent/);
  });

  it("sets metadata and keeps the embed out of search indexes", async () => {
    expect(await generateMetadata(PROPS)).toMatchObject({
      title: "Subscribe to Project news",
      robots: { index: false, follow: false },
    });
  });

  it("404s for unknown slugs or the disabled flag", async () => {
    mocks.newsletter.mockResolvedValue(null);
    await expect(EmbedPage(PROPS)).rejects.toThrow("NOT_FOUND");
    await expect(generateMetadata(PROPS)).rejects.toThrow("NOT_FOUND");
  });

  it("propagates outages", async () => {
    mocks.newsletter.mockRejectedValue(new Error("Core unavailable"));
    await expect(EmbedPage(PROPS)).rejects.toThrow("Core unavailable");
    await expect(generateMetadata(PROPS)).rejects.toThrow("Core unavailable");
  });
});
