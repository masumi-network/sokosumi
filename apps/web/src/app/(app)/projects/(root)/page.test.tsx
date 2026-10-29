import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notificationServiceMock, projectServiceMock, projectsViewMock } =
  vi.hoisted(() => ({
    notificationServiceMock: {
      listNeedsYou: vi.fn(),
    },
    projectServiceMock: {
      listProjects: vi.fn(),
      listRecentActivity: vi.fn(),
    },
    projectsViewMock: vi.fn(),
  }));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/lib/services/notification.service", () => ({
  notificationService: notificationServiceMock,
}));

vi.mock("@/app/projects/components/workspace-column", () => ({
  WorkspaceColumn: () => <aside data-testid="workspace-column" />,
}));

vi.mock("@/app/projects/components/projects-view", () => ({
  ProjectsView: (props: {
    column?: React.ReactNode;
    projects: Array<{ id: string; name: string }>;
    labels: {
      empty: { title: string };
      counts: { tasks: string; jobs: string };
    };
  }) => {
    projectsViewMock(props);

    return (
      <section data-testid="projects-view">
        {props.column}
        <h1>{props.labels.empty.title}</h1>
        {props.projects.map((project) => (
          <article key={project.id}>{project.name}</article>
        ))}
      </section>
    );
  },
}));

function buildProject(overrides?: Partial<{ id: string; name: string }>) {
  return {
    id: "project-1",
    workspaceId: "workspace-1",
    name: "Launch plan",
    briefing: null,
    briefingUrl: null,
    websiteUrl: null,
    logo: null,
    designMd: null,
    memoryEnabled: true,
    memoryModel: {
      id: "mistral/mistral-medium-latest",
      label: "Mistral Medium",
      region: "eu" as const,
    },
    contextMd: null,
    contextMdUpdating: false,
    latestUpdate: null,
    createdAt: "2026-05-27T10:00:00.000Z",
    updatedAt: "2026-05-27T10:00:00.000Z",
    taskCount: 0,
    jobCount: 0,
    ...overrides,
  };
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationServiceMock.listNeedsYou.mockResolvedValue([]);
    projectServiceMock.listRecentActivity.mockResolvedValue([]);
  });

  it("puts the Workspace column beside the Open view and loads both feeds", async () => {
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [buildProject()],
      pagination: null,
    });

    const { ProjectsPageContent } = await import("./page");

    render(await ProjectsPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("workspace-column")).toBeInTheDocument();
    expect(notificationServiceMock.listNeedsYou).toHaveBeenCalledWith(5);
    expect(projectServiceMock.listRecentActivity).toHaveBeenCalledWith(5);
  });

  it("leaves the Closed view's grid at full width, with no column", async () => {
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [buildProject()],
      pagination: null,
    });

    const { ProjectsPageContent } = await import("./page");

    render(
      await ProjectsPageContent({
        searchParams: Promise.resolve({ state: "closed" }),
      }),
    );

    expect(screen.queryByTestId("workspace-column")).not.toBeInTheDocument();
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ column: null }),
    );
    expect(notificationServiceMock.listNeedsYou).not.toHaveBeenCalled();
    expect(projectServiceMock.listRecentActivity).not.toHaveBeenCalled();
  });

  it("forwards the q search param to Core and down to the view", async () => {
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [buildProject()],
      pagination: { cursor: null, limit: 20, nextCursor: null, total: 1 },
    });

    const { ProjectsPageContent } = await import("./page");

    render(
      await ProjectsPageContent({
        searchParams: Promise.resolve({ q: "  launch  " }),
      }),
    );

    // Trimmed, so a stray space cannot change which projects Core returns.
    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      limit: 20,
      query: "launch",
      state: "open",
      pinnedFirst: true,
    });
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "launch" }),
    );
  });

  it("loads projects with embedded counts and passes labels to the view", async () => {
    const projects = [
      buildProject(),
      buildProject({ id: "project-2", name: "Redesign" }),
    ];

    projectServiceMock.listProjects.mockResolvedValue({
      projects,
      pagination: {
        cursor: null,
        limit: 20,
        nextCursor: "project-3",
        total: 3,
      },
    });

    const { ProjectsPageContent } = await import("./page");

    render(
      await ProjectsPageContent({
        searchParams: Promise.resolve({ create: "true" }),
      }),
    );

    expect(screen.getByTestId("projects-view")).toBeInTheDocument();
    expect(screen.getByText("Launch plan")).toBeInTheDocument();
    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      limit: 20,
      query: "",
      state: "open",
      pinnedFirst: true,
    });
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projects,
        initialCreateProjectOpen: true,
        nextCursor: "project-3",
        labels: expect.objectContaining({
          empty: expect.objectContaining({
            title: "App.Projects.empty.title",
          }),
          counts: expect.objectContaining({
            tasks: "App.Projects.list.stats.tasks",
            jobs: "App.Projects.list.stats.jobs",
          }),
        }),
      }),
    );
  });

  it.each([
    [undefined, "open", true],
    ["closed", "closed", false],
    // An unknown value is the default view, not a Core 422.
    ["archived", "open", true],
  ])(
    "lists the %s state as the %s view",
    async (stateParam, state, pinnedFirst) => {
      projectServiceMock.listProjects.mockResolvedValue({
        projects: [],
        pagination: null,
      });

      const { ProjectsPageContent } = await import("./page");

      render(
        await ProjectsPageContent({
          searchParams: Promise.resolve({ state: stateParam }),
        }),
      );

      // Pins lead only the Open view: a Closed card has no Pin to sort by.
      expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
        limit: 20,
        query: "",
        state,
        pinnedFirst,
      });
      expect(projectsViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ state }),
      );
    },
  );

  it("asks Core for one Closed project only when the Open view is empty", async () => {
    projectServiceMock.listProjects
      .mockResolvedValueOnce({ projects: [], pagination: null })
      .mockResolvedValueOnce({ projects: [buildProject()], pagination: null });

    const { ProjectsPageContent } = await import("./page");

    render(await ProjectsPageContent({ searchParams: Promise.resolve({}) }));

    expect(projectServiceMock.listProjects).toHaveBeenLastCalledWith({
      limit: 1,
      state: "closed",
    });
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasClosedProjects: true }),
    );
  });

  it("skips the Closed probe when the Open view has projects or a filter", async () => {
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [],
      pagination: null,
    });

    const { ProjectsPageContent } = await import("./page");

    render(
      await ProjectsPageContent({ searchParams: Promise.resolve({ q: "x" }) }),
    );

    expect(projectServiceMock.listProjects).toHaveBeenCalledOnce();
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasClosedProjects: false }),
    );
  });
});
