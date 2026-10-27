import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { NEWSLETTER_ANALYTICS, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const m = vi.hoisted(() => ({
  enabled: vi.fn(),
  project: vi.fn(),
  listProjects: vi.fn(),
  settings: vi.fn(),
  analytics: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/newsletter/analytics",
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: m.enabled,
    getSettings: m.settings,
    getAnalytics: m.analytics,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: m.project,
    listProjects: m.listProjects,
  },
}));
vi.mock("./newsletter-analytics-view", () => ({
  NewsletterAnalyticsView: ({
    analytics,
  }: {
    analytics: typeof NEWSLETTER_ANALYTICS | null;
  }) => <p>{analytics ? analytics.from : "Invalid range"}</p>,
}));

import NewsletterAnalyticsPage from "./page";

const PROPS = {
  searchParams: Promise.resolve({
    projectId: NEWSLETTER_PROJECT_ID,
    from: "2026-10-01",
    to: "2026-10-02",
  }),
};
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled.mockResolvedValue(true);
  m.project.mockResolvedValue({ id: NEWSLETTER_PROJECT_ID, name: "Launch" });
  m.listProjects.mockResolvedValue({ projects: [], pagination: null });
  m.settings.mockResolvedValue({ id: "n1" });
  m.analytics.mockResolvedValue(NEWSLETTER_ANALYTICS);
});
describe("newsletter analytics page", () => {
  it("loads authorized project analytics and forwards the URL range", async () => {
    render(await NewsletterAnalyticsPage(PROPS));
    expect(m.analytics).toHaveBeenCalledExactlyOnceWith(NEWSLETTER_PROJECT_ID, {
      from: "2026-10-01",
      to: "2026-10-02",
      cursor: undefined,
    });
    expect(screen.getByText("2026-10-01")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Analytics.title" }),
    ).toHaveAttribute("aria-current", "page");
  });
  it("hides disabled newsletters and inaccessible projects before analytics reads", async () => {
    m.enabled.mockResolvedValue(false);
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(m.project).not.toHaveBeenCalled();
    m.enabled.mockResolvedValue(true);
    m.project.mockResolvedValue(null);
    render(await NewsletterAnalyticsPage(PROPS));
    expect(screen.getByText("pickUnavailable")).toBeInTheDocument();
    expect(m.analytics).not.toHaveBeenCalled();
  });
  it("returns to settings until a newsletter is configured", async () => {
    m.settings.mockResolvedValue(null);
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toThrow(
      `REDIRECT:/newsletter/settings?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(m.analytics).not.toHaveBeenCalled();
  });
  it("lets invalid dates recover and preserves upstream failures", async () => {
    m.analytics.mockRejectedValue(
      new CoreApiRequestError("Invalid dates", { status: 422 }),
    );
    render(await NewsletterAnalyticsPage(PROPS));
    expect(screen.getByText("Invalid range")).toBeVisible();
    m.analytics.mockRejectedValue(
      new CoreApiRequestError("Missing newsletter", { status: 404 }),
    );
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toThrow("NOT_FOUND");
    const error = new Error("Unavailable");
    m.analytics.mockRejectedValue(error);
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toBe(error);
  });
});
