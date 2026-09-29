import type { ProjectListItem as ProjectListItemType } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectsView } from "@/app/projects/components/projects-view";
import { PROJECTS_BROWSE_HEADER_ROW_CLASS } from "@/app/projects/constants";

vi.mock("nuqs", () => ({
  useQueryState: () => ["", vi.fn()],
}));

vi.mock("use-debounce", () => ({
  useDebouncedCallback: (fn: (value: string) => void) =>
    Object.assign(fn, { cancel: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(),
}));

vi.mock("@/app/projects/components/create-project-modal", () => ({
  CreateProjectModalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  CreateProjectModal: () => null,
  useCreateProjectModal: () => ({ handleOpen: vi.fn() }),
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: () => <span data-testid="time-ago" />,
}));

const labels = {
  newProject: "New project",
  empty: {
    title: "No projects yet",
    description: "Create one to get started",
    action: "New project",
  },
  loadMore: "Load more",
  loading: "Loading",
  loadMoreError: "Could not load more",
  counts: { tasks: "Tasks", jobs: "Jobs" },
  lastActivity: "Last activity",
  created: "Created",
  pin: "Pin project",
  unpin: "Unpin project",
  pinError: "Could not change the Pin.",
  filter: { placeholder: "Filter projects", clear: "Clear filter" },
  noMatches: "No projects match",
};

const project = {
  id: "project-1",
  workspaceId: "workspace-1",
  name: "Autumn Launch",
  briefing: "Goals",
  briefingUrl: null,
  websiteUrl: null,
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
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  updatedAt: new Date("2026-09-18T10:00:00.000Z"),
  lastActivityAt: new Date("2026-09-18T10:00:00.000Z"),
  taskCount: 3,
  jobCount: 0,
} as ProjectListItemType;

function renderView(
  overrides: Partial<React.ComponentProps<typeof ProjectsView>> = {},
) {
  return render(
    <ProjectsView
      projects={[project]}
      nextCursor={null}
      query=""
      initialCreateProjectOpen={false}
      createProjectModalResetKey="false"
      labels={labels}
      {...overrides}
    />,
  );
}

describe("ProjectsView create control", () => {
  it("sits above the content group beside search", () => {
    renderView();

    const header = screen.getByTestId("projects-toolbar");

    expect(header).toContainElement(
      screen.getByRole("button", { name: "New project" }),
    );
    expect(header).toContainElement(screen.getByLabelText("Filter projects"));
  });

  it("renders the shared header geometry, not just an import of it", () => {
    renderView();

    // The Instant contract test can only grep for the constant's name, which
    // an unused import would satisfy. Assert the tokens reach the DOM, as the
    // skeleton's own test does for its side of the pair.
    const header = screen.getByTestId("projects-toolbar");

    for (const token of PROJECTS_BROWSE_HEADER_ROW_CLASS.split(/\s+/)) {
      expect(header.className).toContain(token);
    }
  });

  it("is the only create button on the browse screen", () => {
    renderView();

    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(
      1,
    );
  });

  it("keeps the toolbar outside the grey content group", () => {
    const { container } = renderView();

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.firstElementChild).toBe(
      screen.getByTestId("projects-toolbar"),
    );
    expect(screen.getByTestId("projects-browse")).not.toContainElement(
      screen.getByLabelText("Filter projects"),
    );
  });

  it("stays desktop-only, since below md the mobile FAB creates", () => {
    renderView();

    const button = screen.getByRole("button", { name: "New project" });
    expect(button.className).toContain("hidden");
    expect(button.className).toContain("md:inline-flex");
  });

  it("still offers create from the empty state when there is nothing to filter", () => {
    renderView({ projects: [], nextCursor: null, query: "" });

    expect(screen.queryByTestId("projects-browse")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(
      1,
    );
  });

  it("keeps the header create reachable when a filter matches nothing", () => {
    renderView({ projects: [], nextCursor: null, query: "zzz" });

    expect(screen.getByTestId("projects-no-matches")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New project" }),
    ).toBeInTheDocument();
  });
});
