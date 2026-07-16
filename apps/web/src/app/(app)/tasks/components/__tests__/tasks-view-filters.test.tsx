import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

const filterDropdownMenuMock = vi.fn();

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="filter-dropdown-menu" />;
  },
}));

import { mockCoworkerOption } from "@/test-fixtures/coworker";

import { TasksViewFilters } from "../tasks-view-filters";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const labels = {
  title: "Filters",
  searchPlaceholder: "Filter...",
  emptyResults: "No results found.",
  all: "All",
  scopeLabel: "Scope",
  scopeOwned: "My tasks",
  scopeWorkspace: "Workspace",
  coworkerLabel: "Coworker",
  statusLabel: "Status",
  projectLabel: "Project",
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
    [TaskStatus.CANCEL_REQUESTED]: "Cancel requested",
    [TaskStatus.CANCELED]: "Canceled",
  },
} as const;

function renderTasksViewFilters(activeOrganizationId: string | null) {
  render(
    <TasksViewFilters
      activeOrganizationId={activeOrganizationId}
      coworkerOptions={[
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
    sections: Array<{ id: string; label: string }>;
  };
}

describe("TasksViewFilters", () => {
  beforeEach(() => {
    filterDropdownMenuMock.mockClear();
    replaceMock.mockClear();
  });

  it("shows scope and coworker sections in workspace context", () => {
    const props = renderTasksViewFilters("org-1");

    expect(props.buttonLabel).toBe("Filters");
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "coworker",
      "status",
      "project",
    ]);
  });

  it("only hides the scope section in personal context", () => {
    const props = renderTasksViewFilters(null);

    expect(props.sections.map((section) => section.id)).toEqual([
      "coworker",
      "status",
      "project",
    ]);
  });
});
