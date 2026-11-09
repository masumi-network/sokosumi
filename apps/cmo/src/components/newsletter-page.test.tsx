// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { cmoOverview } from "../test-fixtures/cmo";
import { NewsletterPage } from "./newsletter-page";

const actions = vi.hoisted(() => ({
  loadCalendarDrafts: vi.fn(),
  loadNewsletter: vi.fn(),
  prepareCalendarIssue: vi.fn(),
  previewNewsletterIssue: vi.fn(),
  changeNewsletterIssue: vi.fn(),
  subscribeNewsletterContacts: vi.fn(),
}));

vi.mock("../app/newsletter-actions", () => actions);

it("opens the linked calendar issue for review and keeps subscriber consent explicit", async () => {
  actions.loadNewsletter.mockResolvedValue({
    state: "ready",
    name: "Acme Weekly",
    publicSlug: "acme-weekly",
    lists: [{ id: "list-1", name: "Newsletter", count: 14 }],
    counts: { ACTIVE: 2, PENDING: 1, BOUNCED: 0, UNSUBSCRIBED: 0 },
    issues: [
      {
        id: "issue-1",
        subject: "Hello",
        status: "NEEDS_APPROVAL",
        approvedAt: null,
        scheduledAt: null,
      },
    ],
  });
  actions.previewNewsletterIssue.mockResolvedValue({
    id: "issue-1",
    revision: 7,
    subject: "Hello",
    status: "NEEDS_APPROVAL",
    approvedAt: null,
    previewText: "A look at what changed this week",
    html: "<p>Preview</p>",
  });
  actions.changeNewsletterIssue.mockResolvedValue(null);
  actions.loadCalendarDrafts.mockResolvedValue({
    issues: [{ id: "issue-1", subject: "Hello" }],
    next: { draft: null, review: null },
  });
  actions.prepareCalendarIssue.mockResolvedValue({ issueId: "issue-1" });
  const closeHandoff = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <NewsletterPage
          overview={cmoOverview()}
          webOrigin="https://app.example.com"
          draft={vi.fn()}
          calendarHandoff={{
            piece: {
              entryId: "calendar-entry",
              strategyId: "strategy-1",
              title: "Weekly launch",
            },
            close: closeHandoff,
          }}
        />,
      );
    });
    expect(container.textContent).toContain("Newsletter (14)");
    expect(container.querySelector('input[name="consent"]:checked')).toBeNull();
    expect(
      container.querySelector(
        'a[href="https://app.example.com/n/acme-weekly"]',
      ),
    ).not.toBeNull();

    const button = (text: string) =>
      [...container.querySelectorAll("button")].find(
        (element) => element.textContent === text,
      );
    expect(button("Approve issue")).toBeUndefined();
    const issue = container.querySelector<HTMLSelectElement>(
      "#calendar-newsletter-issue",
    );
    if (!issue)
      throw new Error("Calendar handoff is missing its issue selection");
    issue.value = "issue-1";
    await act(async () => button("Prepare issue")?.click());

    expect(actions.prepareCalendarIssue).toHaveBeenCalledWith(
      "project-1",
      "strategy-1",
      "calendar-entry",
      "issue-1",
    );
    expect(closeHandoff).toHaveBeenCalledOnce();
    expect(actions.previewNewsletterIssue).toHaveBeenCalledWith(
      "project-1",
      "issue-1",
    );

    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
    expect(container.textContent).toContain("A look at what changed this week");
    expect(button("Schedule send")).toBeUndefined();
    await act(async () => button("Approve issue")?.click());

    expect(actions.changeNewsletterIssue).toHaveBeenCalledWith(
      "project-1",
      "issue-1",
      7,
      { action: "approve" },
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
