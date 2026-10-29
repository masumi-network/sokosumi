import {
  type NewsletterIssue,
  NewsletterIssueStatus,
  NewsletterTemplate,
  type PaginationMetadata,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  change: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  url: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/lib/actions/newsletter/issues", () => ({
  createNewsletterIssue: mocks.create,
  deleteNewsletterIssue: mocks.remove,
}));

vi.mock("@/lib/actions/newsletter/issue-lifecycle", () => ({
  changeNewsletterIssue: mocks.change,
}));

import { Issues } from "./issues";

const PAGINATION: PaginationMetadata = {
  cursor: null,
  nextCursor: null,
  total: 1,
  limit: 25,
};
const COPY = en.App.Projects.Newsletter.Issues;
function renderIssues(
  issues: NewsletterIssue[] = [NEWSLETTER_ISSUE],
  pagination = PAGINATION,
  locale: "en" | "de" | "es" = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ en, de, es }[locale]}
      timeZone="UTC"
      formats={{
        dateTime: { dateTime: { dateStyle: "medium", timeStyle: "short" } },
      }}
    >
      <NuqsTestingAdapter onUrlUpdate={mocks.url} hasMemory>
        <Issues
          projectId={NEWSLETTER_PROJECT_ID}
          issues={issues}
          pagination={pagination}
          activeSubscribers={3}
        />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ ok: true, value: NEWSLETTER_ISSUE });
  mocks.remove.mockResolvedValue({ ok: true, value: null });
});

describe("newsletter issues list", () => {
  it.each([{ issues: [] }, { issues: [NEWSLETTER_ISSUE] }])(
    "offers Write it for me with empty and populated lists: %#",
    ({ issues }) => {
      renderIssues(issues);
      expect(
        screen.getByRole("button", { name: COPY.Ai.action }),
      ).toBeInTheDocument();
    },
  );
  it("shows all translated statuses, delivery dates, editor links, and deletion only for drafts", () => {
    renderIssues(
      Object.values(NewsletterIssueStatus).map((status, index) => ({
        ...NEWSLETTER_ISSUE,
        id: `${index}`,
        status,
        scheduledAt:
          status === "SCHEDULED" ? new Date("2026-11-01T10:00:00Z") : null,
        sentAt: status === "SENT" ? new Date("2026-10-22T10:00:00Z") : null,
      })),
    );
    for (const label of Object.values(COPY.statuses))
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: COPY.Delete.action }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("link", { name: NEWSLETTER_ISSUE.subject })[0],
    ).toHaveAttribute(
      "href",
      `/newsletter/issues/0?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(screen.getByText(/Scheduled for Nov 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Sent Oct 22, 2026/)).toBeInTheDocument();
    for (const [status, action] of Object.entries(COPY.nextActions)) {
      if (status !== "APPROVED")
        expect(screen.getByRole("link", { name: action })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: COPY.Lifecycle.sendNow }),
    ).not.toBeInTheDocument();
  });

  it("offers scheduling only when approval has an approver and timestamp", () => {
    renderIssues([
      {
        ...NEWSLETTER_ISSUE,
        id: "approved",
        status: "NEEDS_APPROVAL",
        approvedAt: new Date(),
        approvedByUserId: "user_1",
      },
      {
        ...NEWSLETTER_ISSUE,
        id: "unapproved",
        status: "NEEDS_APPROVAL",
        approvedAt: new Date(),
        approvedByUserId: null,
      },
    ]);
    expect(
      screen.getByRole("link", { name: COPY.nextActions.APPROVED }),
    ).toHaveAttribute(
      "href",
      `/newsletter/issues/approved?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(
      screen.getByRole("link", { name: COPY.nextActions.NEEDS_APPROVAL }),
    ).toHaveAttribute(
      "href",
      `/newsletter/issues/unapproved?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
  });

  it.each(["en", "de", "es"] as const)(
    "shows failed and partial delivery explanations in %s",
    (locale) => {
      renderIssues(
        [
          {
            ...NEWSLETTER_ISSUE,
            id: "failed",
            status: "FAILED",
            lastError: "Provider unavailable",
          },
          {
            ...NEWSLETTER_ISSUE,
            id: "partial",
            status: "SENT",
            lastError: "2 newsletter sends failed",
          },
        ],
        PAGINATION,
        locale,
      );
      const copy = { en, de, es }[locale].App.Projects.Newsletter.Issues;
      expect(screen.getByText(copy.Delivery.partial)).toBeInTheDocument();
      expect(screen.queryByText(copy.statuses.SENT)).not.toBeInTheDocument();
      expect(screen.getByText(/Provider unavailable/)).toBeInTheDocument();
      expect(screen.getByText(/2 newsletter sends failed/)).toBeInTheDocument();
      expect(screen.getByText(copy.Delivery.partialHelp)).toBeInTheDocument();
      expect(screen.getByText(copy.Delivery.failedHelp)).toBeInTheDocument();
      expect(
        screen.getAllByRole("link", { name: copy.Delivery.reviewSettings }),
      ).toHaveLength(2);
    },
  );

  it.each(Object.values(NewsletterTemplate))(
    "creates a %s issue from the empty state and opens its editor",
    async (template) => {
      const user = userEvent.setup();
      renderIssues([], { ...PAGINATION, total: 0 });
      expect(screen.getByText(COPY.emptyTitle)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: COPY.newIssue }));
      const dialog = screen.getByRole("dialog");
      await user.click(
        within(dialog).getByRole("button", {
          name: new RegExp(`^${COPY.Templates[template].title} `),
        }),
      );
      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith(
          `/newsletter/issues/${NEWSLETTER_ISSUE.id}?projectId=${NEWSLETTER_PROJECT_ID}`,
        ),
      );
      expect(mocks.create).toHaveBeenCalledWith({
        projectId: NEWSLETTER_PROJECT_ID,
        values: expect.objectContaining({
          template,
          subject: COPY.Templates.subject,
          content: expect.any(Array),
        }),
      });
    },
  );

  it("keeps template selection open when creation fails", async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({
      ok: false,
      error: { message: COPY.createError },
    });
    renderIssues();
    await user.click(screen.getByRole("button", { name: COPY.newIssue }));
    await user.click(screen.getByRole("button", { name: /^Text / }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      COPY.createError,
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("requires confirmation to delete a draft and preserves a failed dialog for retry", async () => {
    const user = userEvent.setup();
    renderIssues();
    await user.click(screen.getByRole("button", { name: COPY.Delete.action }));
    expect(mocks.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(NEWSLETTER_ISSUE.subject);
    mocks.remove.mockResolvedValueOnce({
      ok: false,
      error: { message: COPY.Delete.error },
    });
    await user.click(
      within(dialog).getByRole("button", { name: COPY.Delete.action }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      COPY.Delete.error,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: COPY.Delete.action }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.remove).toHaveBeenLastCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
      issueId: NEWSLETTER_ISSUE.id,
    });
  });

  it("uses cursor pagination", async () => {
    const user = userEvent.setup();
    renderIssues([NEWSLETTER_ISSUE], {
      ...PAGINATION,
      nextCursor: NEWSLETTER_ISSUE.id,
      total: 30,
    });
    await user.click(screen.getByRole("button", { name: COPY.nextPage }));
    await waitFor(() =>
      expect(mocks.url).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: `?cursor=${NEWSLETTER_ISSUE.id}`,
        }),
      ),
    );
  });
});
