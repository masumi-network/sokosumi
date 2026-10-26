import type { Newsletter } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getProject: vi.fn(),
  getSettings: vi.fn(),
  form: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/projects/p1/newsletter",
}));
vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "Oct 23, 2026" }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    getSettings: mocks.getSettings,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.getProject },
}));
vi.mock("@/app/projects/components/project-workspace-shell", () => ({
  getProjectWorkspaceLabels: async () => ({}),
  ProjectWorkspaceShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./newsletter-settings-form", () => ({
  NewsletterSettingsForm: (props: object) => {
    mocks.form(props);
    return <div>Settings form</div>;
  },
}));

import ProjectNewsletterPage from "./page";

const PROPS = { params: Promise.resolve({ projectId: "p1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.getProject.mockResolvedValue({
    id: "p1",
    name: "Launch",
    logo: "https://example.com/logo.png",
  });
  mocks.getSettings.mockResolvedValue(null);
});

describe("ProjectNewsletterPage", () => {
  it("returns notFound before reading settings when newsletters are disabled", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(ProjectNewsletterPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("returns notFound for an inaccessible project", async () => {
    mocks.getProject.mockResolvedValue(null);
    await expect(ProjectNewsletterPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("shows setup with project defaults and only a Settings destination", async () => {
    render(await ProjectNewsletterPage(PROPS));
    expect(
      screen.getByRole("heading", { name: "emptyTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Settings form")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/projects/p1/newsletter");
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(mocks.form).toHaveBeenCalledWith(
      expect.objectContaining({
        newsletter: null,
        projectId: "p1",
        projectName: "Launch",
        projectLogo: "https://example.com/logo.png",
      }),
    );
  });

  it("loads existing settings without the setup empty state", async () => {
    const newsletter: Pick<Newsletter, "id" | "name"> = {
      id: "n1",
      name: "Weekly",
    };
    mocks.getSettings.mockResolvedValue(newsletter);
    render(await ProjectNewsletterPage(PROPS));
    expect(mocks.getSettings).toHaveBeenCalledWith("p1");
    expect(
      screen.queryByRole("heading", { name: "emptyTitle" }),
    ).not.toBeInTheDocument();
    expect(mocks.form).toHaveBeenCalledWith(
      expect.objectContaining({ newsletter }),
    );
  });

  it("does not disguise a failed settings read as an empty newsletter", async () => {
    mocks.getSettings.mockRejectedValue(new Error("Core unavailable"));
    await expect(ProjectNewsletterPage(PROPS)).rejects.toThrow(
      "Core unavailable",
    );
    expect(mocks.form).not.toHaveBeenCalled();
  });
});
