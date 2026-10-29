import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_DETAIL_SHELL_CLASS } from "@/app/tasks/constants";

const {
  projectServiceMock,
  notificationServiceMock,
  workspaceColumnMock,
  notFoundMock,
} = vi.hoisted(() => ({
  projectServiceMock: {
    getProjectCloseStatus: vi.fn(),
    getProjectById: vi.fn(),
    getProjectsStats: vi.fn(),
    listRecentActivity: vi.fn(),
  },
  notificationServiceMock: { listNeedsYou: vi.fn() },
  workspaceColumnMock: vi.fn(),
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

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));
vi.mock("@/lib/services/notification.service", () => ({
  notificationService: notificationServiceMock,
}));

// The panels are async Server Components, which this harness cannot render;
// their own tests cover the rows. Here: what the page hands them.
vi.mock("@/app/projects/components/workspace-column", async () => ({
  panelFeed: (
    await vi.importActual<
      typeof import("@/app/projects/components/workspace-column")
    >("@/app/projects/components/workspace-column")
  ).panelFeed,
  WorkspaceColumn: (props: Record<string, unknown>) => {
    workspaceColumnMock(props);
    return <div data-testid="workspace-column" />;
  },
}));

// The Bots tab asks Core about shared bots; off here, as by default.
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { listShared: async () => null },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getActiveOrganizationId: async () => null },
}));

// Stubbed: the pin reads the reader's Pin list through react-query, and this
// file is about the page, not about Pin state.
vi.mock("@/app/projects/components/project-header-actions", () => ({
  ProjectHeaderActions: () => (
    <div>
      <div>Pin project</div>
      <div>Project actions</div>
    </div>
  ),
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

function stats(byStatus: Array<{ status: string; count: number }>) {
  return [
    {
      projectId: "project-1",
      tasks: {
        total: byStatus.reduce((sum, row) => sum + row.count, 0),
        byStatus,
      },
      jobs: { total: 0, byStatus: [] },
    },
  ];
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectServiceMock.getProjectsStats.mockResolvedValue(stats([]));
    projectServiceMock.listRecentActivity.mockResolvedValue([]);
    notificationServiceMock.listNeedsYou.mockResolvedValue([]);
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

  it("is one column of what the project is, beside its panels", async () => {
    const project = buildProject();
    projectServiceMock.getProjectById.mockResolvedValue(project);

    const { default: ProjectDetailPage } = await import("./page");

    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(projectServiceMock.getProjectCloseStatus).not.toHaveBeenCalled();
    expect(projectServiceMock.getProjectsStats).toHaveBeenCalledWith([
      "project-1",
    ]);
    expect(notFoundMock).not.toHaveBeenCalled();

    const { container } = render(html);
    // The task detail shell: same width and gutter as a task page.
    const shell = container.firstChild as HTMLElement;
    for (const cls of TASK_DETAIL_SHELL_CLASS.split(/\s+/)) {
      expect(shell.classList).toContain(cls);
    }
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

    // The one aside is the Properties rail; the sections read top to bottom
    // in one column that fills its track, so they end where the tabs do.
    const asides = container.querySelectorAll("aside");
    expect(asides).toHaveLength(1);
    expect(
      asides[0]?.contains(
        screen.getByText("App.Projects.Detail.header.properties"),
      ),
    ).toBe(true);
    const column = screen.getByTestId("project-briefing").closest(".space-y-8");
    expect(column?.className).not.toContain("max-w-3xl");
    expect(column?.contains(screen.getByTestId("brand-card"))).toBe(true);

    // The strip opens the column; the panels follow it in the DOM, so a
    // phone reaches the content first.
    const strip = screen.getByTestId("project-status-strip");
    expect(column?.firstElementChild).toBe(strip);
    expect(
      screen
        .getByTestId("brand-card")
        .compareDocumentPosition(screen.getByTestId("workspace-column")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Brand comes after the briefing: the briefing is what the project is for,
    // the brand is how it should look.
    expect(
      screen
        .getByTestId("project-briefing")
        .compareDocumentPosition(screen.getByTestId("brand-card")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("navigates Overview, Design and Memory, and nothing else", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    const tabs = screen.getByRole("navigation");
    // Social is a destination in the sidebar now, scoped by `?projectId=`, so
    // it is no longer a tab of the project it posts for.
    expect(
      Array.from(tabs.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/projects/project-1",
      "/projects/project-1/design-md",
      "/projects/project-1/memory",
    ]);
    // Overview is the default tab, and it is the one that is open.
    expect(
      screen.getByRole("link", { name: "App.Projects.Detail.tabs.overview" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("counts the Tasks board's columns, each linking to the project's board", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    projectServiceMock.getProjectsStats.mockResolvedValue(
      stats([
        // In progress: Running and Awaiting external.
        { status: "RUNNING", count: 3 },
        { status: "AWAITING_EXTERNAL", count: 1 },
        // Input required: every status the board puts there.
        { status: "INPUT_REQUIRED", count: 2 },
        { status: "APPROVAL_REQUIRED", count: 1 },
        { status: "OUT_OF_CREDITS", count: 1 },
        // Todo and backlog are on the board but not in the strip.
        { status: "READY", count: 4 },
        { status: "DRAFT", count: 2 },
        // Done: completed, failed and canceled.
        { status: "COMPLETED", count: 12 },
        { status: "FAILED", count: 1 },
        { status: "CANCELED", count: 1 },
      ]),
    );

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    const running = screen.getByTestId("project-status-running");
    const waiting = screen.getByTestId("project-status-waiting");
    const done = screen.getByTestId("project-status-done");
    expect(running).toHaveTextContent("App.Projects.Detail.stats.running4");
    expect(waiting).toHaveTextContent("App.Projects.Detail.stats.waiting4");
    expect(done).toHaveTextContent("App.Projects.Detail.stats.done14");
    // Each opens the project's board, where its column shows that number.
    for (const link of [running, waiting, done]) {
      expect(link).toHaveAttribute("href", "/tasks?projectId=project-1");
    }
    expect(screen.queryByTestId("project-status-open")).toBeNull();
  });

  it("leaves the strip out when the counts fail to load", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    projectServiceMock.getProjectsStats.mockRejectedValue(new Error("down"));

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(screen.queryByTestId("project-status-strip")).toBeNull();
    expect(screen.getByTestId("project-briefing")).toBeInTheDocument();
  });

  it("scopes Needs you and Recent activity to the project", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    notificationServiceMock.listNeedsYou.mockRejectedValue(new Error("down"));

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(notificationServiceMock.listNeedsYou).toHaveBeenCalledWith(
      5,
      "project-1",
    );
    expect(projectServiceMock.listRecentActivity).toHaveBeenCalledWith(
      5,
      "project-1",
    );
    const props = workspaceColumnMock.mock.calls[0]?.[0];
    expect(props).toMatchObject({
      projectScoped: true,
      projects: { "project-1": { name: "Launch plan", logo: null } },
    });
    // A failed feed reaches its panel as null, not as a page error.
    await expect(props.needsYou).resolves.toBeNull();
    await expect(props.activity).resolves.toEqual([]);
  });

  it("keeps both panels on a Closed project", async () => {
    projectServiceMock.getProjectById.mockResolvedValue({
      ...buildProject(),
      closingAt: new Date("2026-09-14T10:00:00.000Z"),
      closedAt: new Date("2026-09-15T10:00:00.000Z"),
    });
    projectServiceMock.getProjectCloseStatus.mockResolvedValue({
      id: "close-1",
      projectId: "project-1",
      state: "CLOSED",
    });

    const { default: ProjectDetailPage } = await import("./page");
    render(
      await ProjectDetailPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(screen.getByTestId("project-close-status")).toHaveTextContent(
      "CLOSED",
    );
    expect(screen.getByTestId("workspace-column")).toBeInTheDocument();
    expect(projectServiceMock.listRecentActivity).toHaveBeenCalledWith(
      5,
      "project-1",
    );
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
