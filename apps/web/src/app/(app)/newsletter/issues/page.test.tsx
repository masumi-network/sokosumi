import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  list: vi.fn(),
  settings: vi.fn(),
  project: vi.fn(),
  listProjects: vi.fn(),
  subscribers: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/newsletter/issues",
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
    listSubscribers: mocks.subscribers,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: mocks.project,
    listProjects: mocks.listProjects,
  },
}));
vi.mock("./issues", () => ({ Issues: () => <p>Issue list</p> }));

import NewsletterIssuesPage from "./page";

const PROPS = {
  searchParams: Promise.resolve({ projectId: NEWSLETTER_PROJECT_ID }),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.project.mockResolvedValue({
    id: NEWSLETTER_PROJECT_ID,
    name: "Launch",
  });
  mocks.settings.mockResolvedValue({ id: "n1" });
  mocks.subscribers.mockResolvedValue({ data: { counts: { ACTIVE: 3 } } });
  mocks.listProjects.mockResolvedValue({ projects: [], pagination: null });
  mocks.list.mockResolvedValue({
    data: [NEWSLETTER_ISSUE],
    meta: {
      pagination: { cursor: null, limit: 25, total: 1, nextCursor: null },
    },
  });
});

describe("newsletter issues page", () => {
  it("hides disabled newsletters before fetching issues", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("returns to newsletter settings until configured", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow(
      `REDIRECT:/newsletter/settings?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("selects Issues, names the project and keeps it on every tab", async () => {
    render(await NewsletterIssuesPage(PROPS));
    expect(
      screen.getByRole("heading", { level: 2, name: "projectTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issues.title" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Subscribers.title" }),
    ).toHaveAttribute(
      "href",
      `/newsletter/subscribers?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(
      screen.getByRole("link", { name: "Calendar.title" }),
    ).toHaveAttribute(
      "href",
      `/newsletter/calendar?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(
      screen.getByRole("link", { name: "Analytics.title" }),
    ).toHaveAttribute(
      "href",
      `/newsletter/analytics?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(screen.getByText("Issue list")).toBeInTheDocument();
  });
  it("lists projects to pick from without a project, keeping the tab", async () => {
    mocks.listProjects.mockResolvedValue({
      projects: [{ id: "project-1", name: "Launch plan" }],
      pagination: null,
    });
    render(await NewsletterIssuesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Launch plan" })).toHaveAttribute(
      "href",
      "/newsletter/issues?projectId=project-1",
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("forwards valid cursors and ignores malformed ones", async () => {
    await NewsletterIssuesPage({
      searchParams: Promise.resolve({
        projectId: NEWSLETTER_PROJECT_ID,
        cursor: NEWSLETTER_ISSUE.id,
      }),
    });
    expect(mocks.list).toHaveBeenLastCalledWith(NEWSLETTER_PROJECT_ID, {
      limit: 25,
      cursor: NEWSLETTER_ISSUE.id,
    });
    await NewsletterIssuesPage({
      searchParams: Promise.resolve({
        projectId: NEWSLETTER_PROJECT_ID,
        cursor: "bad",
      }),
    });
    expect(mocks.list).toHaveBeenLastCalledWith(NEWSLETTER_PROJECT_ID, {
      limit: 25,
    });
  });
  it("handles missing newsletters while propagating Core outages", async () => {
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Missing", { status: 404 }),
    );
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow("NOT_FOUND");
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Unavailable", { status: 503 }),
    );
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow("Unavailable");
  });
});
