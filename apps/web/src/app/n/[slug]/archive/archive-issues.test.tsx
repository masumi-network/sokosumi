import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/actions/newsletter/public", () => ({
  loadPublicNewsletterIssues: mocks.load,
}));

import { ArchiveIssues } from "./archive-issues";

const OLDER_ISSUE = {
  ...PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  publicSlug: "older-news",
  subject: "Earlier news",
  sentAt: new Date("2026-10-16T10:00:00Z"),
};
function renderArchive(locale: "en" | "de" | "es" = "en", empty = false) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ en, de, es }[locale]}
      timeZone="UTC"
    >
      <ArchiveIssues
        slug={PUBLIC_NEWSLETTER_SLUG}
        initialIssues={empty ? [] : [PUBLIC_NEWSLETTER_ISSUE_SUMMARY]}
        initialNextCursor={empty ? null : NEWSLETTER_ISSUE.id}
      />
    </NextIntlClientProvider>,
  );
}
beforeEach(() => vi.resetAllMocks());

describe("public archive issues", () => {
  it.each([
    ["en", "Load more", "October 23, 2026"],
    ["de", "Mehr laden", "23. Oktober 2026"],
    ["es", "Cargar más", "23 de octubre de 2026"],
  ] as const)(
    "renders translated controls and dates in %s",
    (locale, label, date) => {
      renderArchive(locale);
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      expect(screen.getByText(date)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: PUBLIC_NEWSLETTER_ISSUE_SUMMARY.subject,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(PUBLIC_NEWSLETTER_ISSUE_SUMMARY.previewText ?? ""),
      ).toBeInTheDocument();
    },
  );

  it("appends older issues, preserves existing ones and avoids duplicate entries", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      value: {
        data: [PUBLIC_NEWSLETTER_ISSUE_SUMMARY, OLDER_ISSUE],
        meta: { pagination: { nextCursor: null } },
      },
    });
    renderArchive();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("heading", { name: "Earlier news" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith({
      slug: PUBLIC_NEWSLETTER_SLUG,
      cursor: NEWSLETTER_ISSUE.id,
    });
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveAttribute("aria-live", "polite");
  });

  it("preserves the cursor and list on failure so readers can retry", async () => {
    mocks.load
      .mockResolvedValueOnce({
        ok: false,
        error: { message: en.PublicNewsletter.loadError },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          data: [OLDER_ISSUE],
          meta: { pagination: { nextCursor: null } },
        },
      });
    const user = userEvent.setup();
    renderArchive();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.PublicNewsletter.loadError,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("heading", { name: "Earlier news" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.load).toHaveBeenNthCalledWith(2, {
      slug: PUBLIC_NEWSLETTER_SLUG,
      cursor: NEWSLETTER_ISSUE.id,
    });
  });

  it("handles transport failures and allows retry", async () => {
    mocks.load.mockRejectedValue(new Error("Network error"));
    renderArchive();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.PublicNewsletter.loadError,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Load more" }),
      ).not.toBeDisabled(),
    );
  });

  it.each(["en", "de", "es"] as const)(
    "renders the empty state in %s",
    (locale) => {
      renderArchive(locale, true);
      expect(
        screen.getByText({ en, de, es }[locale].PublicNewsletter.emptyTitle),
      ).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("keeps new public message keys in parity with real German and Spanish translations", () => {
    for (const messages of [de, es]) {
      expect(Object.keys(messages.PublicNewsletter).sort()).toEqual(
        Object.keys(en.PublicNewsletter).sort(),
      );
      for (const key of Object.keys(en.PublicNewsletter) as Array<
        keyof typeof en.PublicNewsletter
      >) {
        expect(messages.PublicNewsletter[key]).not.toBe(
          en.PublicNewsletter[key],
        );
      }
      expect(messages.App.Projects.Newsletter.publicArchive).not.toBe(
        en.App.Projects.Newsletter.publicArchive,
      );
      expect(messages.App.Projects.Newsletter.Issues.viewOnWeb).not.toBe(
        en.App.Projects.Newsletter.Issues.viewOnWeb,
      );
    }
  });
});
