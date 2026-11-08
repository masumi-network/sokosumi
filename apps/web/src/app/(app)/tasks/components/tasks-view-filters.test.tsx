import { TaskStatus } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const filterDropdownMenuMock = vi.fn();

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="filter-dropdown-menu" />;
  },
}));

import type { FilterDropdownMenuSection } from "@/components/common/filter-dropdown-menu";
import { mockCoworkerOption } from "@/test-fixtures/coworker";
import { TasksViewFilters } from "./tasks-view-filters";

const replaceMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(", ")})` : key,
}));

const labels = {
  title: "Filters",
  searchPlaceholder: "Filter...",
  emptyResults: "No results found.",
  all: "All",
  scopeLabel: "Scope",
  scopeOwned: "Created by me",
  assignedToMe: "My tasks",
  scopeWorkspace: "Workspace",
  coworkerLabel: "Coworker",
  statusLabel: "Status",
  visibilityLabel: "Visibility",
  visibilityPrivate: "Private",
  statusOptions: {
    [TaskStatus.DRAFT]: "Draft",
    [TaskStatus.QUEUED]: "Queued",
    [TaskStatus.READY]: "Ready",
    [TaskStatus.GRANT_PENDING]: "Grant pending",
    [TaskStatus.INPUT_REQUIRED]: "Input required",
    [TaskStatus.APPROVAL_REQUIRED]: "Approval required",
    [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentication required",
    [TaskStatus.OUT_OF_CREDITS]: "Out of credits",
    [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
    [TaskStatus.RUNNING]: "Running",
    [TaskStatus.AWAITING_EXTERNAL]: "Awaiting external",
    [TaskStatus.COMPLETED]: "Completed",
    [TaskStatus.FAILED]: "Failed",
    [TaskStatus.CANCELED]: "Canceled",
  },
  columns: {
    backlog: "Backlog",
    todo: "Todo",
    "in-progress": "In progress",
    "input-required": "Input required",
    done: "Done",
  },
} as const;

function renderTasksViewFilters(
  activeOrganizationId: string | null,
  userId: string | null = null,
) {
  render(
    <TasksViewFilters
      activeOrganizationId={activeOrganizationId}
      userId={userId}
      coworkerOptions={[
        mockCoworkerOption({ id: "user-1", name: "Me", kind: "user" }),
        mockCoworkerOption({
          id: "coworker-1",
          slug: "elena",
          name: "Elena",
          image: "elena.png",
        }),
      ]}
      projectOptions={[
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Research",
        },
      ]}
      labels={labels}
    />,
  );

  return filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
    buttonLabel: string;
    sections: FilterDropdownMenuSection[];
  };
}

describe("TasksViewFilters", () => {
  beforeEach(() => {
    filterDropdownMenuMock.mockClear();
    replaceMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it("filters to the tasks assigned to the viewer in one click", async () => {
    renderTasksViewFilters("org-1", "user-1");

    await userEvent.click(screen.getByRole("button", { name: "My tasks" }));

    expect(replaceMock).toHaveBeenCalledWith("/tasks?assigneeUserId=user-1");
  });

  it("hides My tasks when the viewer is not an assignee option", () => {
    renderTasksViewFilters("org-1", "someone-else");

    expect(screen.queryByRole("button", { name: "My tasks" })).toBeNull();
  });

  it("shows scope and coworker sections in workspace context", () => {
    const props = renderTasksViewFilters("org-1");

    expect(props.buttonLabel).toBe("Filters");
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "visibility",
      "coworker",
      "status",
    ]);
  });

  it("visibility section supports All and Private only", () => {
    const props = renderTasksViewFilters("org-1");
    const visibilitySection = props.sections.find(
      (section) => section.id === "visibility",
    );

    expect(visibilitySection?.allLabel).toBe("All");
    expect(visibilitySection?.options).toEqual([
      { value: "PRIVATE", label: "Private" },
    ]);
  });

  it("hides scope and visibility sections in personal context", () => {
    const props = renderTasksViewFilters(null);

    expect(props.sections.map((section) => section.id)).toEqual([
      "coworker",
      "status",
    ]);
  });

  it("groups every status under its board column, Done holding the finished ones", () => {
    const props = renderTasksViewFilters(null);
    const status = props.sections.find((section) => section.id === "status");

    expect(status?.options.map((option) => option.value).sort()).toEqual(
      Object.values(TaskStatus).sort(),
    );
    expect(
      status?.options
        .filter((option) => option.group === "Done")
        .map((option) => option.label),
    ).toEqual(["Completed", "Failed", "Canceled"]);
  });

  it("shows no chips without filters", () => {
    renderTasksViewFilters("org-1");

    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows each active filter as a chip that removes only itself", async () => {
    window.history.replaceState(
      null,
      "",
      "/tasks?status=COMPLETED&assigneeId=coworker-1&visibility=PRIVATE&scope=owned",
    );
    searchParams = new URLSearchParams(window.location.search);
    renderTasksViewFilters("org-1");

    const chips = within(
      screen.getByRole("list", { name: "activeFilters" }),
    ).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "chip(Scope, Created by me)",
      "chip(Visibility, Private)",
      "chip(Coworker, Elena)",
      "chip(Status, Completed)",
    ]);

    await userEvent.click(
      screen.getByRole("button", {
        name: "removeFilter(chip(Status, Completed))",
      }),
    );
    expect(replaceMock).toHaveBeenCalledWith(
      "/tasks?assigneeId=coworker-1&visibility=PRIVATE&scope=owned",
    );
    window.history.replaceState(null, "", "/");
  });
});
