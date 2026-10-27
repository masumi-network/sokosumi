import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  get: vi.fn(),
  settings: vi.fn(),
  project: vi.fn(),
  listProjects: vi.fn(),
  editor: vi.fn(),
  marker: vi.fn(),
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
  usePathname: () => `/newsletter/issues/${NEWSLETTER_ISSUE.id}`,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    getIssue: mocks.get,
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
vi.mock("@/app/components/project-scope/project-scope-marker", () => ({
  ProjectScopeMarker: (props: object) => {
    mocks.marker(props);
    return null;
  },
}));
vi.mock("../issue-editor", () => ({
  NewsletterIssueEditor: (props: object) => {
    mocks.editor(props);
    return <p>Issue editor</p>;
  },
}));

import NewsletterIssuePage from "./page";

const PROPS = {
  params: Promise.resolve({ issueId: NEWSLETTER_ISSUE.id }),
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
  mocks.get.mockResolvedValue(NEWSLETTER_ISSUE);
  mocks.listProjects.mockResolvedValue({ projects: [], pagination: null });
});
describe("newsletter issue page", () => {
  it("loads the issue of the chosen project and reports the project", async () => {
    render(await NewsletterIssuePage(PROPS));
    expect(mocks.get).toHaveBeenCalledWith(
      NEWSLETTER_PROJECT_ID,
      NEWSLETTER_ISSUE.id,
    );
    expect(mocks.editor).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: NEWSLETTER_ISSUE,
        projectId: NEWSLETTER_PROJECT_ID,
      }),
    );
    expect(mocks.marker).toHaveBeenCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
    });
    expect(screen.getByRole("link", { name: "Issues.title" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("hides disabled newsletters and missing issues", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterIssuePage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.enabled.mockResolvedValue(true);
    mocks.get.mockResolvedValue(null);
    await expect(NewsletterIssuePage(PROPS)).rejects.toThrow("NOT_FOUND");
  });
  it("shows not found for a missing project instead of failing on its subscribers", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.subscribers.mockRejectedValue(new Error("Project not found"));
    await expect(NewsletterIssuePage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.subscribers).not.toHaveBeenCalled();
  });
  it("returns to settings until a newsletter exists", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(NewsletterIssuePage(PROPS)).rejects.toThrow(
      `REDIRECT:/newsletter/settings?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("shows the unknown-project notice instead of the editor", async () => {
    mocks.project.mockResolvedValue(null);
    render(await NewsletterIssuePage(PROPS));
    expect(screen.getByText("pickUnavailable")).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
