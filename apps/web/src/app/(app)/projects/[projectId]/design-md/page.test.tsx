import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchDesignMdMarkdownMock,
  hasCurrentUserSocialBetaAccessMock,
  notFoundMock,
  projectServiceMock,
} = vi.hoisted(() => ({
  fetchDesignMdMarkdownMock: vi.fn(),
  hasCurrentUserSocialBetaAccessMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  projectServiceMock: { getProjectById: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  usePathname: () => "/projects/project-1/design-md",
}));

vi.mock("next-intl/server", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    getFormatter: async () => createTestFormatter(),
    getTranslations: async (namespace: string) => (key: string) =>
      `${namespace}.${key}`,
  };
});

vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: () => hasCurrentUserSocialBetaAccessMock(),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/components/design-md/design-md-edit-page-shared", () => ({
  fetchDesignMdMarkdown: (url: string) => fetchDesignMdMarkdownMock(url),
}));

vi.mock("@/app/projects/components/project-brand-card", () => ({
  ProjectBrandProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ProjectBrandCard: () => <div data-testid="brand-card">Brand card</div>,
}));

const DESIGN_MD = {
  extractionId: null,
  url: "https://blob.example/design-md/project-1/DESIGN.md",
};

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Launch plan",
    logo: null,
    websiteUrl: "https://example.com",
    designMd: DESIGN_MD,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    ...overrides,
  };
}

describe("ProjectDesignPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserSocialBetaAccessMock.mockResolvedValue(false);
  });

  it("calls notFound when the project is missing", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    const { default: ProjectDesignPage } = await import("./page");

    await expect(
      ProjectDesignPage({ params: Promise.resolve({ projectId: "gone" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(fetchDesignMdMarkdownMock).not.toHaveBeenCalled();
  });

  it("renders the document rather than linking to a blob", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    fetchDesignMdMarkdownMock.mockResolvedValue({
      markdown: "# Brand\n\nThe voice is plain.",
    });

    const { default: ProjectDesignPage } = await import("./page");
    render(
      await ProjectDesignPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(fetchDesignMdMarkdownMock).toHaveBeenCalledWith(DESIGN_MD.url);
    expect(screen.getByText(/The voice is plain/)).toBeInTheDocument();
    // Every action on the file stays in the one card that already owns them.
    expect(screen.getByTestId("brand-card")).toBeInTheDocument();
  });

  it("says there is nothing yet without calling out to fetch it", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(
      buildProject({ designMd: null }),
    );

    const { default: ProjectDesignPage } = await import("./page");
    render(
      await ProjectDesignPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(fetchDesignMdMarkdownMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("App.Projects.Detail.design.empty"),
    ).toBeInTheDocument();
  });

  it("distinguishes a document that failed to load from one that does not exist", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    fetchDesignMdMarkdownMock.mockResolvedValue({ error: true });

    const { default: ProjectDesignPage } = await import("./page");
    render(
      await ProjectDesignPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(
      screen.getByText("App.DesignMd.editLoadErrorDescription"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("App.Projects.Detail.design.empty"),
    ).not.toBeInTheDocument();
  });

  it("marks Design as the open tab in the shared tab strip", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    fetchDesignMdMarkdownMock.mockResolvedValue({ markdown: "# Brand" });

    const { default: ProjectDesignPage } = await import("./page");
    render(
      await ProjectDesignPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "App.Projects.Detail.tabs.design" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
