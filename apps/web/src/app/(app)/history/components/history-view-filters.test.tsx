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

import {
  HistoryActiveFilters,
  HistoryViewFilters,
} from "@/app/history/components/history-view-filters";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/history",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(", ")})` : key,
}));

let searchParams = new URLSearchParams();
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";

function setUrl(query: string) {
  window.history.replaceState(null, "", `/history${query}`);
  searchParams = new URLSearchParams(window.location.search);
}

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
    seoChat: "SEO chat",
    contacts: "Find people",
    topUp: "Top up",
    unattributed: "Other",
  },
} as const;

function renderHistoryViewFilters(activeOrganizationId: string | null) {
  render(
    <HistoryViewFilters
      activeOrganizationId={activeOrganizationId}
      projectOptions={[
        {
          id: PROJECT_ID,
          name: "Research",
        },
      ]}
      labels={labels}
    />,
  );

  return filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
    buttonLabel: string;
    activeCount?: { count: number; label: string };
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
    setUrl("");
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
      "seoChat",
      "contacts",
      "topUp",
      "unattributed",
    ]);
  });

  // The count matches the Filters menu chips: Source and Project. Scope is
  // which ledger you look at, not a narrowing filter, and search has its own box.
  it("counts Source and Project on the Filters button, not scope or search", () => {
    setUrl(`?q=invoice&scope=workspace&type=sokoBot&projectId=${PROJECT_ID}`);
    expect(renderHistoryViewFilters("org-1").activeCount).toEqual({
      count: 2,
      label: "activeCount(2)",
    });

    setUrl("?q=invoice&scope=workspace");
    expect(renderHistoryViewFilters("org-1").activeCount).toBeUndefined();
  });
});

function renderActiveFilters() {
  render(
    <HistoryActiveFilters
      activeOrganizationId="org-1"
      projectOptions={[{ id: PROJECT_ID, name: "Research" }]}
      labels={labels}
    />,
  );
}

describe("HistoryActiveFilters", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    setUrl("");
  });

  it("shows nothing without search, source or project", () => {
    setUrl(`?scope=workspace&taskId=${TASK_ID}`);
    renderActiveFilters();

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows search, source and project as chips that remove only themselves", async () => {
    setUrl(
      `?q=invoice&scope=workspace&type=sokoBot&projectId=${PROJECT_ID}&taskId=${TASK_ID}&utm=x`,
    );
    renderActiveFilters();

    const chips = within(
      screen.getByRole("list", { name: "activeFilters" }),
    ).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "chip(searchLabel, invoice)",
      "chip(Source, Soko Bot)",
      "chip(Project, Research)",
    ]);

    await userEvent.click(
      screen.getByRole("button", {
        name: "removeFilter(chip(Source, Soko Bot))",
      }),
    );
    expect(replaceMock).toHaveBeenLastCalledWith(
      `/history?q=invoice&scope=workspace&projectId=${PROJECT_ID}&taskId=${TASK_ID}&utm=x`,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "removeFilter(chip(searchLabel, invoice))",
      }),
    );
    expect(replaceMock).toHaveBeenLastCalledWith(
      `/history?scope=workspace&type=sokoBot&projectId=${PROJECT_ID}&taskId=${TASK_ID}&utm=x`,
    );
  });

  it("Clear all removes search, source and project and keeps the rest", async () => {
    setUrl(
      `?q=invoice&scope=workspace&type=sokoBot&projectId=${PROJECT_ID}&taskId=${TASK_ID}`,
    );
    renderActiveFilters();

    await userEvent.click(screen.getByRole("button", { name: "clearAll" }));
    expect(replaceMock).toHaveBeenLastCalledWith(
      `/history?scope=workspace&taskId=${TASK_ID}`,
    );
  });

  it("offers Clear all only when more than one chip is shown", () => {
    setUrl("?type=sokoBot");
    renderActiveFilters();

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "clearAll" })).toBeNull();
  });

  it("lets long search chips wrap instead of clipping", () => {
    setUrl(`?q=${"a".repeat(120)}`);
    renderActiveFilters();

    const label = screen.getByText(`chip(searchLabel, ${"a".repeat(120)})`);
    expect(label).toHaveClass("wrap-anywhere");
    expect(label).not.toHaveClass("truncate");
  });
});
