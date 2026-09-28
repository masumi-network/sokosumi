import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const filterDropdownMenuMock = vi.fn();

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="filter-dropdown-menu" />;
  },
}));

import { HistoryViewFilters } from "@/app/history/components/history-view-filters";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/history",
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
  scopeOwned: "My transactions",
  scopeWorkspace: "Workspace",
  typeLabel: "Source",
  projectLabel: "Project",
  typeOptions: {
    job: "Agent job",
    image: "Image",
    task: "Task",
    coworker: "Coworker",
    sokoBot: "Soko Bot",
    unattributed: "Unattributed",
  },
} as const;

function renderHistoryViewFilters(activeOrganizationId: string | null) {
  render(
    <HistoryViewFilters
      activeOrganizationId={activeOrganizationId}
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
    sections: Array<{
      id: string;
      label: string;
      options: Array<{ value: string; label: string }>;
    }>;
  };
}

describe("HistoryViewFilters", () => {
  beforeEach(() => {
    filterDropdownMenuMock.mockClear();
    replaceMock.mockClear();
  });

  it("shows scope, source and project sections in workspace context", () => {
    const props = renderHistoryViewFilters("org-1");

    expect(props.buttonLabel).toBe("Filters");
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "type",
      "project",
    ]);
  });

  it("only hides the scope section in personal context", () => {
    const props = renderHistoryViewFilters(null);

    expect(props.sections.map((section) => section.id)).toEqual([
      "type",
      "project",
    ]);
  });

  // A spend has an amount and a date, not a lifecycle, so the ledger has no
  // status axis to filter on.
  it("offers no status filter", () => {
    const props = renderHistoryViewFilters("org-1");

    expect(
      props.sections.find((section) => section.id === "status"),
    ).toBeUndefined();
  });

  it("offers every consumption source, including the unattributed ones", () => {
    const props = renderHistoryViewFilters("org-1");
    const typeSection = props.sections.find((section) => section.id === "type");

    expect(typeSection?.options.map((option) => option.value)).toEqual([
      "job",
      "image",
      "task",
      "coworker",
      "sokoBot",
      "unattributed",
    ]);
  });
});
