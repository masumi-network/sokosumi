import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { NEWSLETTER_ANALYTICS } from "@/test/newsletter";

const m = vi.hoisted(() => ({
  enabled: vi.fn(),
  project: vi.fn(),
  settings: vi.fn(),
  analytics: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "Oct 1, 2026" }),
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
  projectService: { getProjectById: m.project },
}));
vi.mock("@/app/projects/components/project-workspace-shell", () => ({
  getProjectWorkspaceLabels: async () => ({}),
  ProjectWorkspaceShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/projects/components/project-header-actions", () => ({
  ProjectHeaderActions: () => null,
}));
vi.mock("@/app/projects/components/project-tabs", () => ({
  ProjectTabs: () => null,
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
  params: Promise.resolve({ projectId: "p1" }),
  searchParams: Promise.resolve({ from: "2026-10-01", to: "2026-10-02" }),
};
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled.mockResolvedValue(true);
  m.project.mockResolvedValue({ id: "p1", name: "Launch" });
  m.settings.mockResolvedValue({ id: "n1" });
  m.analytics.mockResolvedValue(NEWSLETTER_ANALYTICS);
});
describe("newsletter analytics page", () => {
  it("loads authorized project analytics and forwards the URL range", async () => {
    render(await NewsletterAnalyticsPage(PROPS));
    expect(m.analytics).toHaveBeenCalledExactlyOnceWith("p1", {
      from: "2026-10-01",
      to: "2026-10-02",
      cursor: undefined,
    });
    expect(screen.getByText("2026-10-01")).toBeVisible();
  });
  it("hides disabled or inaccessible projects before analytics reads", async () => {
    m.enabled.mockResolvedValue(false);
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(m.project).not.toHaveBeenCalled();
    m.enabled.mockResolvedValue(true);
    m.project.mockResolvedValue(null);
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(m.analytics).not.toHaveBeenCalled();
  });
  it("returns to settings until a newsletter is configured", async () => {
    m.settings.mockResolvedValue(null);
    await expect(NewsletterAnalyticsPage(PROPS)).rejects.toThrow(
      "REDIRECT:/projects/p1/newsletter",
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
