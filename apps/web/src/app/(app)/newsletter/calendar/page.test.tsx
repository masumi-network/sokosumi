import type { NewsletterIssue } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import messages from "@/messages/en.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  list: vi.fn(),
  settings: vi.fn(),
  project: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/newsletter/calendar",
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    listIssues: mocks.list,
    getSettings: mocks.settings,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.project },
}));

import { groupIssuesByDate } from "./newsletter-calendar";
import NewsletterCalendarPage from "./page";

const PROPS = {
  searchParams: Promise.resolve({ projectId: NEWSLETTER_PROJECT_ID }),
};

function issue(
  id: string,
  subject: string,
  overrides: Partial<NewsletterIssue>,
): NewsletterIssue {
  return { ...NEWSLETTER_ISSUE, id, subject, ...overrides };
}

const LATER = issue("i-later", "Winter notes", {
  status: "SCHEDULED",
  scheduledAt: new Date("2026-11-20T09:00:00Z"),
  timezone: "UTC",
});
const SOONER = issue("i-sooner", "Holiday hours", {
  status: "SCHEDULED",
  scheduledAt: new Date("2026-11-13T09:00:00Z"),
  timezone: "UTC",
});
const DRAFT = issue("i-draft", "Rough idea", { status: "DRAFT" });
const SENT = issue("i-sent", "Autumn update", {
  status: "SENT",
  sentAt: new Date("2026-11-04T13:37:00Z"),
});

function list(data: NewsletterIssue[], total = data.length) {
  mocks.list.mockResolvedValue({
    data,
    meta: {
      pagination: { cursor: null, limit: 100, total, nextCursor: null },
    },
  });
}

async function renderPage() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      formats={createFormats()}
      timeZone="UTC"
    >
      {await NewsletterCalendarPage(PROPS)}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.project.mockResolvedValue({ id: NEWSLETTER_PROJECT_ID, name: "L" });
  mocks.settings.mockResolvedValue({ id: "n1" });
  list([SENT, DRAFT, LATER, SOONER]);
});

describe("groupIssuesByDate", () => {
  it("puts scheduled issues first, soonest first, then unscheduled, then sent", () => {
    expect(
      groupIssuesByDate([SENT, DRAFT, LATER, SOONER]).map(
        ({ group, issues }) => [group, issues.map((i) => i.id)],
      ),
    ).toEqual([
      ["scheduled", ["i-sooner", "i-later"]],
      ["unscheduled", ["i-draft"]],
      ["sent", ["i-sent"]],
    ]);
  });
});

describe("NewsletterCalendarPage", () => {
  it("is not found when the workspace has no Newsletter", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterCalendarPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns to settings until the newsletter exists", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(NewsletterCalendarPage(PROPS)).rejects.toThrow(
      `REDIRECT:/newsletter/settings?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
  });

  it("keeps the newsletter tabs and lists issues by date and status", async () => {
    await renderPage();
    expect(mocks.list).toHaveBeenCalledWith(NEWSLETTER_PROJECT_ID, {
      limit: 100,
    });
    expect(
      screen.getByRole("link", { name: "Calendar.title" }),
    ).toHaveAttribute("aria-current", "page");
    const next = screen.getByRole("region", { name: "Next issue" });
    expect(within(next).getByText("Fri, Nov 13")).toBeInTheDocument();
    expect(
      within(next).getByRole("link", { name: "Holiday hours" }),
    ).toHaveAttribute(
      "href",
      `/newsletter/issues/i-sooner?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    const scheduled = screen.getByRole("region", { name: "Scheduled" });
    expect(
      within(scheduled)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      expect.stringContaining("Holiday hours"),
      expect.stringContaining("Winter notes"),
    ]);
    expect(within(scheduled).getByText("2 issues")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Not scheduled" }),
    ).toHaveTextContent("Rough idea");
    expect(screen.getByRole("region", { name: "Sent" })).toHaveTextContent(
      "Autumn update",
    );
    expect(
      screen.getByRole("link", { name: "Open full calendar" }),
    ).toHaveAttribute(
      "href",
      `/calendar?types=newsletter&projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it("says when nothing is scheduled and when older issues are left out", async () => {
    list([SENT], 140);
    await renderPage();
    expect(
      screen.getByRole("region", { name: "Next issue" }),
    ).toHaveTextContent("Nothing scheduled yet");
    expect(
      screen.getByText(
        "Showing the newest 1 issues. Open the full calendar to see older ones.",
      ),
    ).toBeInTheDocument();
  });

  it("points an empty newsletter to Issues", async () => {
    list([]);
    await renderPage();
    expect(screen.getByText("No issues yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to issues" })).toHaveAttribute(
      "href",
      `/newsletter/issues?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
  });

  it("handles a missing newsletter and propagates Core outages", async () => {
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Missing", { status: 404 }),
    );
    await expect(NewsletterCalendarPage(PROPS)).rejects.toThrow("NOT_FOUND");
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Unavailable", { status: 503 }),
    );
    await expect(NewsletterCalendarPage(PROPS)).rejects.toThrow("Unavailable");
  });
});
