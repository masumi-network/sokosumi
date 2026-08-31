import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, projectServiceMock, notFoundMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  projectServiceMock: {
    getProjectById: vi.fn(),
    getProjectsStats: vi.fn(),
    listProjectJobs: vi.fn(),
    listProjectTasks: vi.fn(),
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

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
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

vi.mock("@/app/projects/components/project-jobs-section", () => ({
  ProjectJobsSection: () => null,
}));

vi.mock("@/app/projects/components/project-tasks-section", () => ({
  ProjectTasksSection: () => null,
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
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
  };
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });
  });

  it("calls notFound without loading jobs or tasks when the project is missing", async () => {
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
    expect(projectServiceMock.listProjectJobs).not.toHaveBeenCalled();
    expect(projectServiceMock.listProjectTasks).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("loads jobs and tasks in parallel after the project exists", async () => {
    const project = buildProject();
    projectServiceMock.getProjectById.mockResolvedValue(project);
    projectServiceMock.listProjectJobs.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    projectServiceMock.listProjectTasks.mockResolvedValue({
      tasks: [],
      pagination: null,
    });

    const { default: ProjectDetailPage } = await import("./page");

    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(projectServiceMock.listProjectJobs).toHaveBeenCalledWith(
      "project-1",
      { limit: 100 },
    );
    expect(projectServiceMock.listProjectTasks).toHaveBeenCalledWith(
      "project-1",
      { limit: 100 },
    );
    expect(projectServiceMock.getProjectsStats).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();

    const { container } = render(html);
    expect(container.firstChild).toHaveClass(
      "w-[calc(100%+2rem)]",
      "-mx-4",
      "py-6",
      "md:mx-0",
      "md:w-full",
      "md:px-6",
    );
    expect(container.firstChild).not.toHaveClass("px-4");
    expect(container.firstChild).not.toHaveClass("w-full");
    expect(container.querySelector(".max-w-4xl")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Launch plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "App.Projects.Detail.navigation.calendar",
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
    expect(screen.getByTestId("brand-card")).toBeInTheDocument();
    expect(screen.getByTestId("memory-stat")).toBeInTheDocument();
    const workspaceHeading = screen.getByText(
      "App.Projects.Detail.modules.title",
    );
    expect(workspaceHeading).toBeInTheDocument();
    expect(workspaceHeading.closest("section")?.className).toContain("px-4");
    expect(workspaceHeading.closest("section")?.className).toContain("md:px-0");
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

  it("hides the Calendar tab for non-beta sessions", async () => {
    const project = buildProject();
    getSessionMock.mockResolvedValue({ user: { email: "member@example.com" } });
    projectServiceMock.getProjectById.mockResolvedValue(project);
    projectServiceMock.listProjectJobs.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    projectServiceMock.listProjectTasks.mockResolvedValue({
      tasks: [],
      pagination: null,
    });

    const { default: ProjectDetailPage } = await import("./page");
    const html = await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    });

    render(html);

    expect(
      screen.queryByRole("link", {
        name: "App.Projects.Detail.navigation.calendar",
      }),
    ).not.toBeInTheDocument();
  });
});
