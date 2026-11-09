// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { cmoOverview } from "../test-fixtures/cmo";
import { NewsletterPage } from "./newsletter-page";

const actions = vi.hoisted(() => ({
  loadNewsletter: vi.fn(),
  previewNewsletterIssue: vi.fn(),
  changeNewsletterIssue: vi.fn(),
  subscribeNewsletterContacts: vi.fn(),
}));

vi.mock("../app/newsletter-actions", () => actions);

it("previews the saved issue before approval and keeps subscriber consent explicit", async () => {
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
    await act(async () => button("Preview")?.click());

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
