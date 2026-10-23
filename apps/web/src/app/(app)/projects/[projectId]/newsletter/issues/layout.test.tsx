import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  project: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/projects/p1/newsletter/issues/i1",
}));
vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "Oct 23, 2026" }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: mocks.enabled, getSettings: mocks.settings },
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

import NewsletterIssuesLayout from "./layout";

const PROPS = {
  params: Promise.resolve({ projectId: "p1" }),
  children: <p>Issue content</p>,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.project.mockResolvedValue({ id: "p1", name: "Launch" });
  mocks.settings.mockResolvedValue({ id: "n1" });
});

describe("newsletter issues layout", () => {
  it("hides the route when the feature is disabled or the project is inaccessible", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterIssuesLayout(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.project).not.toHaveBeenCalled();
    mocks.enabled.mockResolvedValue(true);
    mocks.project.mockResolvedValue(null);
    await expect(NewsletterIssuesLayout(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("returns to newsletter settings until configured", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(NewsletterIssuesLayout(PROPS)).rejects.toThrow(
      "REDIRECT:/projects/p1/newsletter",
    );
  });
  it("uses the shared navigation and selects Issues on editor routes", async () => {
    render(await NewsletterIssuesLayout(PROPS));
    expect(screen.getByRole("link", { name: "Issues.title" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Subscribers.title" }),
    ).toHaveAttribute("href", "/projects/p1/newsletter/subscribers");
    expect(
      screen.getByRole("link", { name: "Analytics.title" }),
    ).toHaveAttribute("href", "/projects/p1/newsletter/analytics");
    expect(screen.getByText("Issue content")).toBeInTheDocument();
  });
});
