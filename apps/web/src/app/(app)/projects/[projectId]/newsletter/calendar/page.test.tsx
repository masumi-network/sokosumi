import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEWSLETTER_ISSUE } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  project: vi.fn(),
  settings: vi.fn(),
  list: vi.fn(),
  calendar: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/projects/p1/newsletter/calendar",
}));
vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "Oct 23, 2026" }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    getSettings: mocks.settings,
    listIssues: mocks.list,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.project },
}));
vi.mock("@/app/projects/components/project-workspace-shell", () => ({
  getProjectWorkspaceLabels: async () => ({}),
  ProjectWorkspaceShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./calendar", () => ({
  NewsletterCalendar: (props: object) => {
    mocks.calendar(props);
    return <div>Newsletter month</div>;
  },
}));

import NewsletterCalendarPage from "./page";

const page = (data: unknown[], nextCursor: string | null = null) => ({
  data,
  meta: { pagination: { cursor: null, limit: 100, total: 0, nextCursor } },
});
const props = (searchParams = {}) => ({
  params: Promise.resolve({ projectId: "p1" }),
  searchParams: Promise.resolve(searchParams),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.project.mockResolvedValue({ id: "p1", name: "Launch" });
  mocks.settings.mockResolvedValue({ id: "n1" });
  mocks.list.mockResolvedValue(page([]));
});

describe("newsletter calendar page", () => {
  it("is unreachable outside the newsletter beta or for inaccessible projects", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterCalendarPage(props())).rejects.toThrow("NOT_FOUND");
    expect(mocks.project).not.toHaveBeenCalled();
    mocks.enabled.mockResolvedValue(true);
    mocks.project.mockResolvedValue(null);
    await expect(NewsletterCalendarPage(props())).rejects.toThrow("NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns to newsletter settings until configured", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(NewsletterCalendarPage(props())).rejects.toThrow(
      "REDIRECT:/projects/p1/newsletter",
    );
  });

  it("reads the month's issues from the newsletter list and keeps delivered ones", async () => {
    const scheduled = { ...NEWSLETTER_ISSUE, id: "a", status: "SCHEDULED" };
    const failed = { ...NEWSLETTER_ISSUE, id: "b", status: "FAILED" };
    const sent = { ...NEWSLETTER_ISSUE, id: "c", status: "SENT" };
    mocks.list
      .mockResolvedValueOnce(page([scheduled, failed], "b"))
      .mockResolvedValueOnce(page([sent]));
    render(
      await NewsletterCalendarPage(
        props({ month: "2026-10", timezone: "Europe/Berlin" }),
      ),
    );
    const range = {
      from: new Date("2026-09-26T22:00:00Z"),
      to: new Date("2026-10-31T23:00:00Z"),
    };
    expect(mocks.list).toHaveBeenNthCalledWith(1, "p1", {
      limit: 100,
      ...range,
    });
    expect(mocks.list).toHaveBeenNthCalledWith(2, "p1", {
      limit: 100,
      ...range,
      cursor: "b",
    });
    expect(mocks.calendar).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        month: "2026-10",
        timeZone: "Europe/Berlin",
        issues: [scheduled, sent],
      }),
    );
    expect(
      screen.getByRole("link", { name: "Calendar.title" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
