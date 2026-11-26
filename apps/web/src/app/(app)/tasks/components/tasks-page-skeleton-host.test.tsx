import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";
import { TASK_CARD_DENSITY_CLASS } from "@/app/tasks/constants";

let searchParams = new URLSearchParams();

vi.mock("@/app/tasks/actions", () => ({
  saveTasksView: vi.fn(async () => true),
  exportTasks: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(", ")})` : key,
}));

// Cached data from another workspace: the query hands it out even while
// disabled, so the shell must not read it.
const CACHED_TAG = {
  id: "11223344-55aa-7111-8123-456789012345",
  displayName: "Personal tag",
  archived: false,
};
const useWorkspaceTagsMock = vi.fn((..._args: unknown[]) => ({
  data: [CACHED_TAG],
}));
vi.mock("@/queries/workspace-tags", () => ({
  useWorkspaceTags: (...args: unknown[]) => useWorkspaceTagsMock(...args),
}));

const COOKIES = ["tasks_view_mode", "tasks_density"];

afterEach(() => {
  searchParams = new URLSearchParams();
  for (const name of COOKIES) {
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

function renderHost() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { gcTime: Number.POSITIVE_INFINITY },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
      }
    >
      <NuqsTestingAdapter searchParams={searchParams.toString()}>
        <TasksPageSkeletonHost />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

describe("TasksPageSkeletonHost", () => {
  it("draws compact card placeholders when the density cookie says compact", () => {
    document.cookie = "tasks_view_mode=board; path=/";
    document.cookie = "tasks_density=compact; path=/";

    renderHost();

    for (const card of screen.getAllByTestId("task-card-skeleton")) {
      expect(card.className).toContain(TASK_CARD_DENSITY_CLASS.compact);
    }
  });

  it("draws the board's toolbar before the board loads, inert", () => {
    const { container } = renderHost();

    // `inert` hides the toolbar from the accessibility tree, so query the DOM.
    const toolbar = container.querySelector("[inert]");
    expect(toolbar).not.toBeNull();
    expect(
      toolbar?.querySelector('[role="group"], [role="radiogroup"]'),
    ).not.toBeNull();
    expect(toolbar?.querySelector('input[type="search"]')).not.toBeNull();
    expect(
      within(toolbar as HTMLElement).getByRole("button", {
        name: "Display.button",
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  it("draws the URL's filter chips in the toolbar", () => {
    searchParams = new URLSearchParams("status=DRAFT&q=menu");

    const { container } = renderHost();

    const toolbar = container.querySelector("[inert]") as HTMLElement;
    expect(
      within(toolbar).getByRole("list", {
        name: "activeFilters",
        hidden: true,
      }),
    ).toHaveTextContent("Filters.statusOptions.DRAFT");
    expect(toolbar.querySelector('input[type="search"]')).toHaveValue("menu");
  });

  it("sends no workspace request of its own", () => {
    renderHost();

    expect(useWorkspaceTagsMock).toHaveBeenCalled();
    for (const [, options] of useWorkspaceTagsMock.mock.calls) {
      expect(options).toMatchObject({ enabled: false });
    }
  });

  it("names no cached workspace tag, even for a tag in the URL", () => {
    searchParams = new URLSearchParams(`tag=${CACHED_TAG.id}`);

    const { container } = renderHost();

    expect(container).not.toHaveTextContent(CACHED_TAG.displayName);
    expect(
      within(container.querySelector("[inert]") as HTMLElement).getByRole(
        "list",
        { name: "activeFilters", hidden: true },
      ),
    ).toHaveTextContent("workspaceTags");
  });
});
