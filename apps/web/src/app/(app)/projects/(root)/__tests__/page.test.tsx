import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectServiceMock, projectsViewMock } = vi.hoisted(() => ({
  projectServiceMock: {
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
      counts: { tasks: string; jobs: string };
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
    expect(projectsViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
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
});
