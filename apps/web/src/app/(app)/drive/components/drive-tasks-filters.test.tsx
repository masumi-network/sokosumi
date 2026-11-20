import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilterDropdownMenuSection } from "@/components/common/filter-dropdown-menu";
import { TestQueryProvider } from "@/test/query-provider";

const getCoworkersMock = vi.fn();
const getProjectsByIdMock = vi.fn();
const getTasksByIdMock = vi.fn();
const fetchDriveTasksPageMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/drive",
  useSearchParams: () => new URLSearchParams("view=tasks"),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({ id: "browser-core-client" }),
}));

vi.mock("@sokosumi/core-client", () => ({
  getCoworkers: (...args: unknown[]) => getCoworkersMock(...args),
  getProjectsById: (...args: unknown[]) => getProjectsByIdMock(...args),
  getTasksById: (...args: unknown[]) => getTasksByIdMock(...args),
}));

vi.mock("@/lib/utils/drive-tasks-list.client", () => ({
  fetchDriveTasksPage: (...args: unknown[]) => fetchDriveTasksPageMock(...args),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: ({
    sections,
  }: {
    sections: FilterDropdownMenuSection[];
  }) => (
    <div>
      {sections.map((section) => (
        <section key={section.id} data-testid={`section-${section.id}`}>
          <ul>
            {section.options.map((option) => (
              <li key={option.value}>{option.label}</li>
            ))}
          </ul>
          {section.pagination?.nextCursor ? (
            <button
              type="button"
              data-testid={`load-more-${section.id}`}
              disabled={section.pagination.isLoadingMore}
              onClick={section.pagination.onLoadMore}
            >
              {section.pagination.loadMoreLabel}
            </button>
          ) : null}
        </section>
      ))}
    </div>
  ),
}));

import {
  buildDriveTasksFilterParams,
  DriveTasksFilters,
} from "./drive-tasks-filters";

const LABELS = {
  title: "Filter",
  searchPlaceholder: "Search...",
  emptyResults: "No results",
  all: "All",
  coworkerLabel: "Agent",
  projectLabel: "Project",
  taskLabel: "Task",
  noProjectLabel: "No project",
  loadMore: "Load more",
  retryLoadMore: "Retry",
};

describe("buildDriveTasksFilterParams", () => {
  it("clears project and task drill-down when assignee changes", () => {
    const params = new URLSearchParams(
      "view=tasks&assigneeId=cow-1&projectId=proj-1&taskId=task-1",
    );

    const next = buildDriveTasksFilterParams(params, "assigneeId", "cow-2");

    expect(next.get("assigneeId")).toBe("cow-2");
    expect(next.has("projectId")).toBe(false);
    expect(next.has("taskId")).toBe(false);
  });

  it("clears task drill-down when project changes", () => {
    const params = new URLSearchParams(
      "view=tasks&projectId=proj-1&taskId=task-1",
    );

    const next = buildDriveTasksFilterParams(params, "projectId", "proj-2");

    expect(next.get("projectId")).toBe("proj-2");
    expect(next.has("taskId")).toBe(false);
  });

  it("clears assignee when set to all", () => {
    const params = new URLSearchParams(
      "view=tasks&assigneeId=cow-1&projectId=proj-1&taskId=task-1",
    );

    const next = buildDriveTasksFilterParams(params, "assigneeId", null);

    expect(next.has("assigneeId")).toBe(false);
    expect(next.has("projectId")).toBe(false);
    expect(next.has("taskId")).toBe(false);
  });
});

describe("DriveTasksFilters pagination recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoworkersMock.mockResolvedValue({ data: { data: [] } });
  });

  it("keeps loaded project pages and shows a retry row when loading a later page fails", async () => {
    const user = userEvent.setup();
    fetchDriveTasksPageMock
      .mockResolvedValueOnce({
        items: [{ type: "project", id: "proj-1", name: "Alpha Project" }],
        nextCursor: "cursor-2",
      })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        items: [{ type: "project", id: "proj-2", name: "Beta Project" }],
        nextCursor: null,
      });

    render(
      <TestQueryProvider>
        <DriveTasksFilters
          activeOrganizationId="org-1"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={LABELS}
        />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("Alpha Project")).toBeVisible();
    const loadMore = screen.getByTestId("load-more-project");
    expect(loadMore).toHaveTextContent("Load more");

    await user.click(loadMore);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-project")).toHaveTextContent(
        "Retry",
      );
    });
    expect(screen.getByText("Alpha Project")).toBeVisible();

    await user.click(screen.getByTestId("load-more-project"));

    expect(await screen.findByText("Beta Project")).toBeVisible();
    expect(screen.getByText("Alpha Project")).toBeVisible();
    expect(screen.queryByTestId("load-more-project")).not.toBeInTheDocument();
  });

  it("keeps loaded task pages and shows a retry row when loading a later page fails", async () => {
    const user = userEvent.setup();
    fetchDriveTasksPageMock.mockImplementation(
      async (input: { projectId?: string; cursor?: string }) => {
        if (!input.projectId) {
          return {
            items: [{ type: "project", id: "proj-1", name: "Alpha Project" }],
            nextCursor: null,
          };
        }
        if (!input.cursor) {
          return {
            items: [{ type: "task", id: "task-1", name: "First Task" }],
            nextCursor: "task-cursor-2",
          };
        }
        return Promise.reject(new Error("network down"));
      },
    );

    render(
      <TestQueryProvider>
        <DriveTasksFilters
          activeOrganizationId="org-1"
          assigneeId={null}
          projectId="proj-1"
          taskId={null}
          labels={LABELS}
        />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("First Task")).toBeVisible();
    expect(screen.getByTestId("load-more-task")).toHaveTextContent("Load more");

    await user.click(screen.getByTestId("load-more-task"));

    await waitFor(() => {
      expect(screen.getByTestId("load-more-task")).toHaveTextContent("Retry");
    });
    expect(screen.getByText("First Task")).toBeVisible();
  });
});
