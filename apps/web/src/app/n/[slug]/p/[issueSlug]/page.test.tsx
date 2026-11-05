import { render, screen } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import {
  PUBLIC_NEWSLETTER,
  PUBLIC_NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ newsletter: vi.fn(), issue: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    getPublicNewsletter: mocks.newsletter,
    getPublicIssue: mocks.issue,
  },
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "de",
  getTranslations: async () =>
    createTranslator({
      locale: "de",
      messages: de,
      namespace: "PublicNewsletter",
    }),
  getFormatter: async () => createFormatter({ locale: "de", timeZone: "UTC" }),
}));

import PublicIssuePage, { generateMetadata } from "./page";

const PROPS = {
  params: Promise.resolve({
    slug: PUBLIC_NEWSLETTER_SLUG,
    issueSlug: PUBLIC_NEWSLETTER_ISSUE_SUMMARY.publicSlug,
  }),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.newsletter.mockResolvedValue(PUBLIC_NEWSLETTER);
  mocks.issue.mockResolvedValue(PUBLIC_NEWSLETTER_ISSUE);
});

describe("public issue page", () => {
  it("isolates Core HTML in an iframe without script or same-origin permission", async () => {
    render(await PublicIssuePage(PROPS));
    expect(
      screen.getByRole("heading", { name: PUBLIC_NEWSLETTER_ISSUE.subject }),
    ).toBeInTheDocument();
    expect(screen.getByText("23. Oktober 2026")).toBeInTheDocument();
    const frame = screen.getByTitle(
      `Newsletter-Ausgabe: ${PUBLIC_NEWSLETTER_ISSUE.subject}`,
    );
    expect(frame).toHaveAttribute("srcdoc", PUBLIC_NEWSLETTER_ISSUE.html);
    // Links in the issue open in a new tab; no scripts or same-origin access.
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-popups allow-popups-to-escape-sandbox",
    );
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveClass("min-h-[48rem]");
    expect(screen.queryByText("Our latest update")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zurück zum Archiv" }),
    ).toHaveAttribute("href", `/n/${PUBLIC_NEWSLETTER_SLUG}/archive`);
    expect(screen.getByRole("link", { name: "Abonnieren" })).toHaveAttribute(
      "href",
      `/n/${PUBLIC_NEWSLETTER_SLUG}`,
    );
    expect(mocks.issue).toHaveBeenCalledWith(
      PUBLIC_NEWSLETTER_SLUG,
      PUBLIC_NEWSLETTER_ISSUE_SUMMARY.publicSlug,
      "de",
    );
  });

  it("sets subject, preview text, sent date and the public URL for sharing", async () => {
    expect(await generateMetadata(PROPS)).toMatchObject({
      title: PUBLIC_NEWSLETTER_ISSUE.subject,
      description: PUBLIC_NEWSLETTER_ISSUE.previewText,
      openGraph: {
        title: PUBLIC_NEWSLETTER_ISSUE.subject,
        description: PUBLIC_NEWSLETTER_ISSUE.previewText,
        type: "article",
        publishedTime: PUBLIC_NEWSLETTER_ISSUE.sentAt.toISOString(),
        url: `https://app.sokosumi.com/n/${PUBLIC_NEWSLETTER_SLUG}/p/${PUBLIC_NEWSLETTER_ISSUE_SUMMARY.publicSlug}`,
      },
    });
  });

  it("uses the newsletter name when preview text is empty", async () => {
    mocks.issue.mockResolvedValue({
      ...PUBLIC_NEWSLETTER_ISSUE,
      previewText: null,
    });
    expect((await generateMetadata(PROPS)).description).toBe(
      PUBLIC_NEWSLETTER.name,
    );
  });

  it.each(["newsletter", "issue"])(
    "404s for missing or disabled %s in page and metadata",
    async (target) => {
      mocks[target as "newsletter" | "issue"].mockResolvedValue(null);
      await expect(PublicIssuePage(PROPS)).rejects.toThrow("NOT_FOUND");
      await expect(generateMetadata(PROPS)).rejects.toThrow("NOT_FOUND");
    },
  );

  it("propagates outages", async () => {
    mocks.issue.mockRejectedValue(new Error("Core unavailable"));
    await expect(PublicIssuePage(PROPS)).rejects.toThrow("Core unavailable");
    await expect(generateMetadata(PROPS)).rejects.toThrow("Core unavailable");
  });
});
