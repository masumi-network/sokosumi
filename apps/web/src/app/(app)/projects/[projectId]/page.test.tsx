import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasCurrentUserCalendarBetaAccessMock,
  projectServiceMock,
  notFoundMock,
} = vi.hoisted(() => ({
  hasCurrentUserCalendarBetaAccessMock: vi.fn(),
  projectServiceMock: {
    getProjectById: vi.fn(),
    getProjectsStats: vi.fn(),
    getProjectNeedsAttention: vi.fn(),
  },
  notFoundMock: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/calendar-beta-access.server", () => ({
  hasCurrentUserCalendarBetaAccess: () =>
    hasCurrentUserCalendarBetaAccessMock(),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/app/projects/components/project-detail-actions", () => ({
  ProjectDetailActions: () => <div>Project actions</div>,
}));

vi.mock("@/app/projects/components/project-memory-row", () => ({
  ProjectMemoryRow: () => <div data-testid="memory-stat">Memory stat</div>,
}));

vi.mock("@/app/projects/components/project-brand-card", () => ({
  ProjectBrandProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ProjectBrandCard: () => <div data-testid="brand-card">Brand card</div>,
}));

vi.mock("@/app/projects/components/project-needs-attention-section", () => ({
  ProjectNeedsAttentionSection: () => (
    <div data-testid="needs-attention-section">Needs attention</div>
  ),
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
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
  };
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(true);
  });

  it("calls notFound without loading needs-attention when the project is missing", async () => {
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
    expect(projectServiceMock.getProjectNeedsAttention).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("loads needs-attention after the project exists", async () => {
    const project = buildProject();
    projectServiceMock.getProjectById.mockResolvedValue(project);
    projectServiceMock.getProjectNeedsAttention.mockResolvedValue({
      taskCount: 3,
      jobCount: 2,
      items: [],
    });

    const { default: ProjectDetailPage } = await import("./page");

    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(projectServiceMock.getProjectNeedsAttention).toHaveBeenCalledWith(
      "project-1",
    );
    expect(projectServiceMock.getProjectsStats).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();

    const { container } = render(html);
    expect(container.firstChild).toHaveClass(
      "mx-auto",
      "w-full",
      "max-w-6xl",
      "py-6",
    );
    expect(container.firstChild).not.toHaveClass("-mx-4");
    expect(container.firstChild).not.toHaveClass("w-[calc(100%+2rem)]");
    expect(container.firstChild).not.toHaveClass("md:px-6");
    expect(container.querySelector(".max-w-4xl")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Launch plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "App.Projects.Detail.modules.calendar.title",
      }),
    ).toHaveAttribute("href", "/projects/project-1/calendar");
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute(
      "href",
      "https://example.com/about",
    );
    expect(
      screen.getByRole("heading", {
        name: "App.Projects.Detail.briefing",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("project-latest-update"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("brand-card")).toBeInTheDocument();
    expect(screen.getByTestId("memory-stat")).toBeInTheDocument();
    expect(screen.getByTestId("needs-attention-section")).toBeInTheDocument();

    const layoutGrid = container.querySelector(
      ".xl\\:grid-cols-\\[minmax\\(0\\,1fr\\)_minmax\\(16rem\\,20rem\\)\\]",
    );
    expect(layoutGrid).toBeTruthy();
    expect(layoutGrid?.className).not.toContain("lg:grid-cols-");

    const introColumn = screen
      .getByRole("heading", { name: "Launch plan" })
      .closest(".space-y-8");
    const aside = screen.getByTestId("brand-card").closest("aside");
    const needsAttentionColumn = screen
      .getByTestId("needs-attention-section")
      .closest(".space-y-8");
    expect(introColumn).toBeTruthy();
    expect(aside).toBeTruthy();
    expect(aside?.className).toContain("xl:row-span-2");
    expect(needsAttentionColumn).toBeTruthy();
    expect(aside?.contains(screen.getByTestId("memory-stat"))).toBe(true);
    expect(aside?.contains(screen.getByTestId("brand-card"))).toBe(true);
    expect(aside?.contains(screen.getByTestId("needs-attention-section"))).toBe(
      false,
    );
    expect(introColumn?.contains(screen.getByTestId("brand-card"))).toBe(false);
    expect(
      needsAttentionColumn?.contains(
        screen.getByTestId("needs-attention-section"),
      ),
    ).toBe(true);
    expect(
      introColumn?.contains(screen.getByTestId("needs-attention-section")),
    ).toBe(false);

    const briefingHeading = screen.getByRole("heading", {
      name: "App.Projects.Detail.briefing",
    });
    const brandCard = screen.getByTestId("brand-card");
    const needsAttention = screen.getByTestId("needs-attention-section");
    expect(
      briefingHeading.compareDocumentPosition(brandCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      brandCard.compareDocumentPosition(needsAttention) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(layoutGrid?.className).not.toContain("order-");
    expect(layoutGrid?.className).not.toContain("xl:grid-cols-3");
    expect(layoutGrid?.className).not.toContain("xl:col-span-2");

    expect(container.innerHTML).not.toContain(
      "bg-card-background border-border rounded-none border p-4",
    );
    const workspaceHeading = screen.getByText(
      "App.Projects.Detail.modules.title",
    );
    expect(workspaceHeading).toBeInTheDocument();
    const workspaceSection = workspaceHeading.closest("section");
    expect(workspaceSection?.className).toContain("space-y-3");
    expect(workspaceSection?.className).not.toContain("xl:col-span-2");
    expect(workspaceSection?.querySelector(".grid")?.className).toContain(
      "md:grid-cols-4",
    );
    expect(workspaceSection?.querySelector(".grid")?.className).not.toContain(
      "xl:grid-cols-7",
    );
    expect(workspaceSection?.className).not.toContain("px-4");
    expect(workspaceSection?.className).not.toContain("md:px-0");
    expect(needsAttentionColumn?.contains(workspaceSection!)).toBe(true);
    expect(container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(
      6,
    );
    const fileBrowserLink = screen.getByRole("link", {
      name: /App\.Projects\.Detail\.modules\.fileBrowser\.title/i,
    });
    expect(fileBrowserLink).toHaveAttribute(
      "href",
      `/drive?view=tasks&projectId=${project.id}`,
    );
  });

  it("hides the Calendar card for non-beta sessions", async () => {
    const project = buildProject();
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(false);
    projectServiceMock.getProjectById.mockResolvedValue(project);
    projectServiceMock.getProjectNeedsAttention.mockResolvedValue({
      taskCount: 0,
      jobCount: 0,
      items: [],
    });

    const { default: ProjectDetailPage } = await import("./page");
    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    render(html);

    expect(
      screen.queryByRole("link", {
        name: "App.Projects.Detail.modules.calendar.title",
      }),
    ).not.toBeInTheDocument();
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
    projectServiceMock.getProjectNeedsAttention.mockResolvedValue({
      taskCount: 0,
      jobCount: 0,
      items: [],
    });

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
    const latestUpdate = screen.getByTestId("project-latest-update");
    const briefing = screen.getByTestId("project-briefing");
    const introColumn = latestHeading.closest(".space-y-8");
    expect(introColumn?.contains(latestUpdate)).toBe(true);
    expect(introColumn?.contains(briefing)).toBe(true);
    expect(screen.getByText(/Shipped/)).toBeInTheDocument();
  });
});
