import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasCurrentUserSocialBetaAccessMock, projectServiceMock, notFoundMock } =
  vi.hoisted(() => ({
    hasCurrentUserSocialBetaAccessMock: vi.fn(),
    projectServiceMock: {
      getProjectCloseStatus: vi.fn(),
      getProjectById: vi.fn(),
      getProjectsStats: vi.fn(),
    },
    notFoundMock: vi.fn(() => {
      throw new Error("NOT_FOUND");
    }),
  }));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  // The project tab bar reads the current route to mark its own tab.
  usePathname: () => "/projects/project-1",
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

vi.mock("@/app/projects/components/project-detail-actions", () => ({
  ProjectDetailActions: () => <div>Project actions</div>,
}));

// Stubbed like its sibling above: it reads the reader's Pin list through
// react-query, and this file is about the page, not about Pin state.
vi.mock("@/app/projects/components/project-detail-pin-button", () => ({
  ProjectDetailPinButton: () => <div>Pin project</div>,
}));

vi.mock("@/app/projects/components/project-close-status", () => ({
  ProjectCloseStatusCard: ({ status }: { status: { state: string } }) => (
    <div data-testid="project-close-status">{status.state}</div>
  ),
}));

vi.mock("@/app/projects/components/project-brand-card", () => ({
  ProjectBrandProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ProjectBrandCard: () => <div data-testid="brand-card">Brand card</div>,
}));

function buildProject() {
  return {
    id: "project-1",
    workspaceId: "workspace-1",
    name: "Launch plan",
    briefing: null,
    briefingUrl: null,
    websiteUrl: "https://example.com/about",
    logo: null,
    designMd: null,
    memoryEnabled: true,
    memoryModel: {
      id: "mistral/mistral-medium-latest",
      label: "Mistral Medium",
      region: "eu",
    },
    contextMd: null,
    contextMdUpdating: false,
    latestUpdate: null,
    projectRevision: 3,
    closingAt: null,
    closedAt: null,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
  };
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserSocialBetaAccessMock.mockResolvedValue(true);
  });

  it("calls notFound when the project is missing", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    const { default: ProjectDetailPage } = await import("./page");

    await expect(
      ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-missing" }),
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(projectServiceMock.getProjectById).toHaveBeenCalledWith(
      "project-missing",
    );
    expect(projectServiceMock.getProjectsStats).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("is one column of what the project is, and nothing else", async () => {
    const project = buildProject();
    projectServiceMock.getProjectById.mockResolvedValue(project);

    const { default: ProjectDetailPage } = await import("./page");

    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(projectServiceMock.getProjectCloseStatus).not.toHaveBeenCalled();
    expect(projectServiceMock.getProjectsStats).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();

    const { container } = render(html);
    expect(container.firstChild).toHaveClass("w-full", "min-w-0");
    expect(container.firstChild).not.toHaveClass("max-w-6xl");
    expect(container.firstChild).not.toHaveClass("mx-auto");
    expect(container.firstChild).not.toHaveClass("-mx-4");
    expect(
      screen.getByRole("heading", { name: "Launch plan" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute(
      "href",
      "https://example.com/about",
    );
    expect(
      screen.getByRole("heading", { name: "App.Projects.Detail.briefing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("project-latest-update"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("brand-card")).toBeInTheDocument();

    // Every removed section, asserted absent rather than assumed gone: the
    // calendar and the workspace tiles are top-level destinations or gone,
    // needs-attention is gone, and memory has a tab of its own.
    expect(
      screen.queryByTestId("needs-attention-section"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/modules\.title/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/modules\.comingSoonList/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("project-memory-panel"),
    ).not.toBeInTheDocument();
    for (const href of [
      "/projects/project-1/calendar",
      "/projects/project-1/studio",
      "/drive?view=tasks&projectId=project-1",
    ]) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    }

    // The grid and its aside are gone with the things that filled them: what
    // is left reads top to bottom in one capped column.
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector('[class*="xl:grid-cols-"]')).toBeNull();
    const column = screen.getByTestId("project-briefing").closest(".space-y-8");
    expect(column?.className).toContain("max-w-3xl");
    expect(column?.contains(screen.getByTestId("brand-card"))).toBe(true);

    // Brand comes after the briefing: the briefing is what the project is for,
    // the brand is how it should look.
    expect(
      screen
        .getByTestId("project-briefing")
        .compareDocumentPosition(screen.getByTestId("brand-card")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("navigates Overview, Design and Memory, plus Social inside the beta", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    const tabs = screen.getByRole("navigation");
    expect(
      Array.from(tabs.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/projects/project-1",
      "/projects/project-1/design-md",
      "/projects/project-1/memory",
      "/projects/project-1/social",
    ]);
    // Overview is the default tab, and it is the one that is open.
    expect(
      screen.getByRole("link", { name: "App.Projects.Detail.tabs.overview" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("drops the Social tab outside the beta", async () => {
    hasCurrentUserSocialBetaAccessMock.mockResolvedValue(false);
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(
      Array.from(screen.getByRole("navigation").querySelectorAll("a")).map(
        (link) => link.getAttribute("href"),
      ),
    ).toEqual([
      "/projects/project-1",
      "/projects/project-1/design-md",
      "/projects/project-1/memory",
    ]);
  });

  it("loads and renders close status only after closing starts", async () => {
    const project = {
      ...buildProject(),
      closingAt: new Date("2026-09-14T10:00:00.000Z"),
    };
    const closeStatus = {
      id: "close-1",
      projectId: "project-1",
      state: "CLOSING",
    };
    projectServiceMock.getProjectById.mockResolvedValue(project);
    projectServiceMock.getProjectCloseStatus.mockResolvedValue(closeStatus);

    const { default: ProjectDetailPage } = await import("./page");
    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(projectServiceMock.getProjectCloseStatus).toHaveBeenCalledWith(
      "project-1",
    );
    render(html);
    expect(screen.getByTestId("project-close-status")).toHaveTextContent(
      "CLOSING",
    );
  });

  it("renders Latest update above Briefing when a report exists", async () => {
    const project = {
      ...buildProject(),
      latestUpdate: {
        content:
          "# Weekly Activity Report\n\nDate window: 2026-09-01 to 2026-09-07\n\n## TL;DR\n\nShipped.",
        updatedAt: "2026-09-07T10:00:00.000Z",
      },
    };
    projectServiceMock.getProjectById.mockResolvedValue(project);

    const { default: ProjectDetailPage } = await import("./page");
    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    render(html);

    const latestHeading = screen.getByRole("heading", {
      name: "App.Projects.Detail.latestUpdate",
    });
    const briefingHeading = screen.getByRole("heading", {
      name: "App.Projects.Detail.briefing",
    });
    expect(latestHeading.compareDocumentPosition(briefingHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const column = latestHeading.closest(".space-y-8");
    expect(column?.contains(screen.getByTestId("project-latest-update"))).toBe(
      true,
    );
    expect(column?.contains(screen.getByTestId("project-briefing"))).toBe(true);
    expect(screen.getByText(/Shipped/)).toBeInTheDocument();
  });
});
