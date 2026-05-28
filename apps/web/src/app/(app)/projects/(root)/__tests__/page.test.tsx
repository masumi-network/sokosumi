import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectServiceMock, projectsViewMock } = vi.hoisted(() => ({
  projectServiceMock: {
    getProjectsStats: vi.fn(),
    listProjects: vi.fn(),
  },
  projectsViewMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/app/projects/components/projects-view", () => ({
  ProjectsView: (props: {
    projects: Array<{ id: string; name: string }>;
    labels: {
      empty: { title: string };
      stats: {
        taskStatusLabels: Record<string, string>;
        jobStatusLabels: Record<string, string>;
      };
    };
  }) => {
    projectsViewMock(props);

    return (
      <section data-testid="projects-view">
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
    description: null,
    createdAt: "2026-05-27T10:00:00.000Z",
    updatedAt: "2026-05-27T10:00:00.000Z",
    ...overrides,
  };
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads projects, fetches row stats for the page ids, and passes labels to the view", async () => {
    const projects = [
      buildProject(),
      buildProject({ id: "project-2", name: "Redesign" }),
    ];
    const stats = [
      {
        projectId: "project-1",
        tasks: {
          total: 2,
          byStatus: [{ status: "READY", count: 2 }],
        },
        jobs: {
          total: 1,
          byStatus: [{ status: "completed", count: 1 }],
        },
      },
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
    projectServiceMock.getProjectsStats.mockResolvedValue(stats);

    const { default: ProjectsPage } = await import("../page");

    render(
      await ProjectsPage({
        searchParams: Promise.resolve({ create: "true" }),
      }),
    );

    expect(screen.getByTestId("projects-view")).toBeInTheDocument();
    expect(screen.getByText("Launch plan")).toBeInTheDocument();
    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      limit: 20,
    });
    expect(projectServiceMock.getProjectsStats).toHaveBeenCalledWith([
      "project-1",
      "project-2",
    ]);
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCreateProjectOpen: true,
        nextCursor: "project-3",
        statsByProjectId: {
          "project-1": stats[0],
        },
        labels: expect.objectContaining({
          empty: expect.objectContaining({
            title: "App.Projects.empty.title",
          }),
          stats: expect.objectContaining({
            taskStatusLabels: expect.objectContaining({
              READY: "App.Projects.list.stats.taskStatusAbbreviations.READY",
            }),
            jobStatusLabels: expect.objectContaining({
              completed:
                "App.Projects.list.stats.jobStatusAbbreviations.completed",
            }),
          }),
        }),
      }),
    );
  });
});
