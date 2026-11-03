import { render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import {
  PUBLIC_NEWSLETTER,
  PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ newsletter: vi.fn(), list: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    getPublicNewsletter: mocks.newsletter,
    listPublicIssues: mocks.list,
  },
}));
vi.mock("@/lib/actions/newsletter/public", () => ({
  loadPublicNewsletterIssues: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "PublicNewsletter",
    }),
}));

import ArchivePage, { generateMetadata } from "./page";

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
  mocks.list.mockResolvedValue({
    data: [PUBLIC_NEWSLETTER_ISSUE_SUMMARY],
    meta: { pagination: { nextCursor: null } },
  });
});

describe("public archive page", () => {
  it("renders public brand, sent issues, locale dates and signup links", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        {await ArchivePage(PROPS)}
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Archive" }),
    ).toBeInTheDocument();
    expect(screen.getByText(PUBLIC_NEWSLETTER.name)).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveStyle({
      borderTopColor: BRANDED_NEWSLETTER.brand.primaryColor,
      borderBottomColor: BRANDED_NEWSLETTER.brand.accentColor,
    });
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      PUBLIC_NEWSLETTER.brand.logoUrl,
    );
    expect(screen.getByText("October 23, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subscribe" })).toHaveAttribute(
      "href",
      `/n/${PUBLIC_NEWSLETTER_SLUG}`,
    );
    expect(screen.getByRole("link", { name: /Weekly news/ })).toHaveAttribute(
      "href",
      `/n/${PUBLIC_NEWSLETTER_SLUG}/p/${PUBLIC_NEWSLETTER_ISSUE_SUMMARY.publicSlug}`,
    );
    expect(mocks.list).toHaveBeenCalledWith(PUBLIC_NEWSLETTER_SLUG, {});
  });

  it("renders the no-issues state", async () => {
    mocks.list.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        {await ArchivePage(PROPS)}
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No issues yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("sets sharing metadata from the public newsletter", async () => {
    const metadata = await generateMetadata(PROPS);
    expect(metadata).toMatchObject({
      title: "Project news archive",
      description: "Read past issues of Project news.",
      openGraph: {
        title: "Project news archive",
        url: `https://app.sokosumi.com/n/${PUBLIC_NEWSLETTER_SLUG}/archive`,
        type: "website",
      },
    });
  });

  it("404s in both page and metadata for unknown slugs or the disabled feature", async () => {
    mocks.newsletter.mockResolvedValue(null);
    await expect(ArchivePage(PROPS)).rejects.toThrow("NOT_FOUND");
    await expect(generateMetadata(PROPS)).rejects.toThrow("NOT_FOUND");
    mocks.newsletter.mockResolvedValue(PUBLIC_NEWSLETTER);
    mocks.list.mockResolvedValue(null);
    await expect(ArchivePage(PROPS)).rejects.toThrow("NOT_FOUND");
  });

  it("propagates outages instead of treating them as missing newsletters", async () => {
    mocks.newsletter.mockRejectedValue(new Error("Core unavailable"));
    await expect(ArchivePage(PROPS)).rejects.toThrow("Core unavailable");
    await expect(generateMetadata(PROPS)).rejects.toThrow("Core unavailable");
  });
});
