import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import en from "@/messages/en.json";
import { NEWSLETTER_ISSUE, PUBLIC_NEWSLETTER_SLUG } from "@/test/newsletter";
import { IssueHeader } from "./issue-header";

function renderHeader(props: Partial<Parameters<typeof IssueHeader>[0]>) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      formats={createFormats()}
      timeZone="UTC"
    >
      <IssueHeader
        issue={NEWSLETTER_ISSUE}
        newsletterSlug={PUBLIC_NEWSLETTER_SLUG}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("IssueHeader", () => {
  it("names a sent issue, when it went out, to how many, and its web copy", () => {
    renderHeader({
      issue: {
        ...NEWSLETTER_ISSUE,
        status: "SENT",
        sentAt: new Date("2026-11-04T13:37:00Z"),
      },
      recipients: 2,
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Weekly news" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(
      screen.getByText("Sent Nov 4, 1:37 PM to 2 subscribers"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on web" })).toHaveAttribute(
      "href",
      `/n/${PUBLIC_NEWSLETTER_SLUG}/p/${NEWSLETTER_ISSUE.publicSlug}`,
    );
  });

  it("shows a draft's status and last edit without a web copy", () => {
    renderHeader({});
    expect(
      screen.getByRole("heading", { level: 2, name: "Weekly news" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View on web" })).toBeNull();
  });
});
