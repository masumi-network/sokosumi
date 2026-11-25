import type { Coworker, DriveTasksListItem } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveTasksPageResult } from "@/lib/utils/drive-tasks-list.client";

const {
  fetchDriveTasksPageMock,
  getCoworkersMock,
  getProjectsByIdMock,
  getTasksByIdMock,
  replaceMock,
} = vi.hoisted(() => ({
  fetchDriveTasksPageMock: vi.fn(),
  getCoworkersMock: vi.fn(),
  getProjectsByIdMock: vi.fn(),
  getTasksByIdMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/lib/utils/drive-tasks-list.client", () => ({
  fetchDriveTasksPage: (...args: unknown[]) => fetchDriveTasksPageMock(...args),
}));

vi.mock("@sokosumi/core-client", () => ({
  getCoworkers: (...args: unknown[]) => getCoworkersMock(...args),
  getProjectsById: (...args: unknown[]) => getProjectsByIdMock(...args),
  getTasksById: (...args: unknown[]) => getTasksByIdMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({ id: "browser-core-client" }),
}));

let currentSearchParams = new URLSearchParams("view=tasks");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/drive",
  useSearchParams: () => currentSearchParams,
}));

import {
  buildDriveTasksFilterParams,
  DriveTasksFilters,
} from "./drive-tasks-filters";

const DEFAULT_LABELS = {
  title: "Filter",
  searchPlaceholder: "Search...",
  emptyResults: "No results",
  all: "All",
  coworkerLabel: "Coworker",
  projectLabel: "Project",
  taskLabel: "Task",
  noProjectLabel: "No project",
  loadMore: "Load more",
  retry: "Retry",
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

function projectRow(id: string, name: string): DriveTasksListItem {
  return {
    type: "project",
    id,
    name,
    latestFileUpdatedAt: new Date("2026-08-25T10:00:00.000Z"),
  };
}

function taskRow(id: string, name: string): DriveTasksListItem {
  return {
    type: "task",
    id,
    name,
    latestFileUpdatedAt: new Date("2026-08-25T10:00:00.000Z"),
  };
}

function coworkerRow(id: string, name: string): Coworker {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    image: null,
  } as unknown as Coworker;
}

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

  it("writes the displayed projectId when clearing taskId on a task-only URL", () => {
    const params = new URLSearchParams("view=tasks&taskId=task-p2");

    const next = buildDriveTasksFilterParams(params, "taskId", null, "proj-p2");

    expect(next.get("projectId")).toBe("proj-p2");
    expect(next.has("taskId")).toBe(false);
  });
});

describe("DriveTasksFilters", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams("view=tasks");
    fetchDriveTasksPageMock.mockReset();
    getCoworkersMock.mockReset();
    getProjectsByIdMock.mockReset();
    getTasksByIdMock.mockReset();
    replaceMock.mockReset();

    fetchDriveTasksPageMock.mockResolvedValue({ items: [], nextCursor: null });
    getCoworkersMock.mockResolvedValue({ data: { data: [] } });
  });

  it("never shows project A's name after switching the project filter from A to B", async () => {
    const client = makeQueryClient();
    const projALookup = Promise.withResolvers<{
      data: { data: { id: string; name: string } };
    }>();
    getProjectsByIdMock.mockImplementationOnce(() => projALookup.promise);
    fetchDriveTasksPageMock.mockImplementation(
      async ({ projectId }: { projectId?: string }) => {
        if (projectId) {
          return { items: [taskRow("task-b", "Task B")], nextCursor: null };
        }
        return {
          items: [projectRow("proj-b", "Project Beta")],
          nextCursor: null,
        };
      },
    );

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId="proj-a"
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    // Switch project filter from A to B (and settle any lookup if the old path fired one).
    rerender(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId="proj-b"
          taskId="task-b"
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await act(async () => {
      projALookup.resolve({
        data: { data: { id: "proj-a", name: "Project Alpha" } },
      });
      await projALookup.promise;
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Project Project Beta" }),
      ).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "Task Task B" })).toBeVisible();
    expect(screen.queryByText("Project Alpha")).not.toBeInTheDocument();
    expect(getProjectsByIdMock).not.toHaveBeenCalled();
    expect(getTasksByIdMock).not.toHaveBeenCalled();
  });

  it("never renders a coworkers response for workspace A under workspace B", async () => {
    const user = userEvent.setup();
    const client = makeQueryClient();
    const orgACoworkers = Promise.withResolvers<{
      data: { data: Coworker[] };
    }>();
    const orgBCoworkers = Promise.withResolvers<{
      data: { data: Coworker[] };
    }>();

    getCoworkersMock
      .mockImplementationOnce(() => orgACoworkers.promise)
      .mockImplementationOnce(() => orgBCoworkers.promise);

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getCoworkersMock).toHaveBeenCalledTimes(1);
    });

    // Switch workspace from A to B before A's coworkers request resolves.
    rerender(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_b"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getCoworkersMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      orgACoworkers.resolve({
        data: { data: [coworkerRow("cw-a", "Alice Org A")] },
      });
      await orgACoworkers.promise;
    });

    await user.click(screen.getByRole("button", { name: /Coworker/i }));
    expect(screen.queryByRole("option", { name: /Alice Org A/ })).toBeNull();

    await act(async () => {
      orgBCoworkers.resolve({
        data: { data: [coworkerRow("cw-b", "Bob Org B")] },
      });
      await orgBCoworkers.promise;
    });

    expect(
      await screen.findByRole("option", { name: /Bob Org B/ }),
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: /Alice Org A/ })).toBeNull();
  });

  it("disables Load more while page one refreshes on return and shows Retry when Load more fails", async () => {
    const user = userEvent.setup();
    const client = makeQueryClient();
    const refreshPageOne = Promise.withResolvers<DriveTasksPageResult>();

    fetchDriveTasksPageMock
      .mockResolvedValueOnce({
        items: [projectRow("proj-1", "Project One")],
        nextCursor: "cursor-2",
      })
      .mockImplementationOnce(() => refreshPageOne.promise)
      .mockRejectedValueOnce(new Error("page 2 failed"))
      .mockResolvedValueOnce({
        items: [projectRow("proj-2", "Project Two")],
        nextCursor: null,
      });

    const { unmount } = render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Project/i }));
    expect(
      await screen.findByRole("option", { name: "Project One" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "Load more" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    // Return to Drive: cached page 1 stays visible while staleTime: 0 refetches page 1,
    // disabling Load more until page 1 finishes refreshing.
    unmount();

    render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Project/i }));
    expect(
      await screen.findByRole("option", { name: "Project One" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Load more" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await act(async () => {
      refreshPageOne.resolve({
        items: [projectRow("proj-1", "Project One")],
        nextCursor: "cursor-2",
      });
      await refreshPageOne.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Load more" })).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });

    // Next page fails: loaded page 1 stays visible and Retry replaces Load more.
    await user.click(screen.getByRole("option", { name: "Load more" }));

    const retryOption = await screen.findByRole("option", { name: "Retry" });
    expect(retryOption).toBeVisible();
    expect(screen.getByRole("option", { name: "Project One" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Load more" })).toBeNull();

    // Clicking Retry loads page 2 and appends it.
    await user.click(retryOption);

    expect(
      await screen.findByRole("option", { name: "Project Two" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "Project One" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Retry" })).toBeNull();
  });

  it("never renders workspace A project options under workspace B when workspace A resolves late", async () => {
    const user = userEvent.setup();
    const client = makeQueryClient();
    const orgAProjects = Promise.withResolvers<DriveTasksPageResult>();

    fetchDriveTasksPageMock
      .mockImplementationOnce(() => orgAProjects.promise)
      .mockResolvedValueOnce({
        items: [projectRow("proj-b", "Org B Project")],
        nextCursor: null,
      });

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_b"
          assigneeId={null}
          projectId={null}
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Project/i }));
    expect(
      await screen.findByRole("option", { name: "Org B Project" }),
    ).toBeVisible();

    await act(async () => {
      orgAProjects.resolve({
        items: [projectRow("proj-a", "Org A Project")],
        nextCursor: null,
      });
      await orgAProjects.promise;
    });

    expect(screen.queryByRole("option", { name: "Org A Project" })).toBeNull();
    expect(screen.getByRole("option", { name: "Org B Project" })).toBeVisible();
  });

  it("shows selected project and task names on a cold deep link when both are on page 2", async () => {
    const client = makeQueryClient();
    fetchDriveTasksPageMock.mockImplementation(
      async ({ projectId }: { projectId?: string }) => {
        if (projectId === "proj-p2") {
          return {
            items: [taskRow("task-p1", "Page 1 Task")],
            nextCursor: "cursor-tasks-2",
            selectedProject: { id: "proj-p2", name: "Page 2 Project" },
          };
        }
        return {
          items: [projectRow("proj-p1", "Page 1 Project")],
          nextCursor: "cursor-projects-2",
        };
      },
    );

    render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId="proj-p2"
          taskId="task-p2"
          selectedProject={{ id: "proj-p2", name: "Page 2 Project" }}
          selectedTask={{ id: "task-p2", name: "Page 2 Task" }}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Project Page 2 Project" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Task Page 2 Task" }),
      ).toBeVisible();
    });
    expect(getProjectsByIdMock).not.toHaveBeenCalled();
    expect(getTasksByIdMock).not.toHaveBeenCalled();
  });

  it("reads selectedProject directly from the Level 2 drill-down response when a page-2 project is filtered", async () => {
    const client = makeQueryClient();
    fetchDriveTasksPageMock.mockImplementation(
      async ({ projectId }: { projectId?: string }) => {
        if (projectId === "proj-p2") {
          return {
            items: [taskRow("task-1", "Task One")],
            nextCursor: null,
            selectedProject: { id: "proj-p2", name: "Page 2 Project" },
          };
        }
        return {
          items: [projectRow("proj-p1", "Page 1 Project")],
          nextCursor: "cursor-projects-2",
        };
      },
    );

    render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId="proj-p2"
          taskId={null}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Project Page 2 Project" }),
    ).toBeVisible();
    expect(getProjectsByIdMock).not.toHaveBeenCalled();
  });

  it("keeps the inferred projectId in the URL when clearing Task on a task-only link", async () => {
    const user = userEvent.setup();
    const client = makeQueryClient();
    currentSearchParams = new URLSearchParams("view=tasks&taskId=task-p2");

    render(
      <QueryClientProvider client={client}>
        <DriveTasksFilters
          activeOrganizationId="org_a"
          assigneeId={null}
          projectId="proj-p2"
          taskId="task-p2"
          selectedProject={{ id: "proj-p2", name: "Page 2 Project" }}
          selectedTask={{ id: "task-p2", name: "Page 2 Task" }}
          labels={DEFAULT_LABELS}
          sheetOpen
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Task Page 2 Task" }));
    await user.click(screen.getByRole("option", { name: "All" }));

    expect(replaceMock).toHaveBeenCalledWith(
      "/drive?view=tasks&projectId=proj-p2",
    );
  });
});
