import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentJobStatus } from "@/lib/clients/generated/core";

const filterDropdownMenuMock = vi.fn();

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="filter-dropdown-menu" />;
  },
}));

import { JobsViewFilters } from "./jobs-view-filters";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const filtersLabels = {
  title: "Filters",
  searchPlaceholder: "Filter...",
  emptyResults: "No results found.",
  all: "All",
  scopeLabel: "Scope",
  scopeOwned: "My tasks",
  scopeWorkspace: "Workspace",
} as const;

const labels = {
  filterButton: "Filters",
  agentLabel: "Agent",
  jobStatusLabel: "Job status",
  jobStatusOptions: {
    [AgentJobStatus.INITIATED]: "Initiated",
    [AgentJobStatus.AWAITING_PAYMENT]: "Awaiting payment",
    [AgentJobStatus.AWAITING_INPUT]: "Awaiting input",
    [AgentJobStatus.RUNNING]: "Running",
    [AgentJobStatus.COMPLETED]: "Completed",
    [AgentJobStatus.FAILED]: "Failed",
  },
} as const;

function renderJobsViewFilters(activeOrganizationId: string | null) {
  render(
    <JobsViewFilters
      activeOrganizationId={activeOrganizationId}
      agentOptions={[{ id: "agent-1", name: "Scout", image: null }]}
      projectOptions={[
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Research",
        },
      ]}
      filtersLabels={filtersLabels}
      labels={labels}
    />,
  );

  return filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
    buttonLabel: string;
    sections: Array<{ id: string; label: string }>;
  };
}

describe("JobsViewFilters", () => {
  beforeEach(() => {
    filterDropdownMenuMock.mockClear();
    replaceMock.mockClear();
  });

  it("omits the project section now owned by the switcher", () => {
    const props = renderJobsViewFilters("org-1");

    expect(props.buttonLabel).toBe("Filters");
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "agent",
      "jobStatus",
    ]);
  });

  it("only hides the scope section in personal context", () => {
    const props = renderJobsViewFilters(null);

    expect(props.sections.map((section) => section.id)).toEqual([
      "agent",
      "jobStatus",
    ]);
  });
});
