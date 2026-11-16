import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const filterDropdownMenuMock = vi.fn();

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="filter-dropdown-menu" />;
  },
}));

import { HistoryToolbar } from "@/app/history/components/history-toolbar";
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

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 300,
  }),
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

// The page search box debounces its URL write. Removing the Search chip or
// Clear all while that write is pending must win; the timer must not bring
// the old search back.
describe("HistoryToolbar search reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replaceMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    setUrl("");
  });

  function renderToolbar() {
    const props = {
      activeOrganizationId: "org-1",
      filters: {
        q: null,
        scope: "owned" as const,
        type: null,
        projectId: null,
        taskId: null,
      },
      projectOptions: [{ id: PROJECT_ID, name: "Research" }],
      resultsCountLabel: "1 result",
      labels: {
        search: { placeholder: "Search transactions", clear: "Clear" },
        filters: labels,
      },
    };
    const view = render(<HistoryToolbar {...props} />);
    return {
      input: () =>
        screen.getByPlaceholderText("Search transactions") as HTMLInputElement,
      rerender: () => view.rerender(<HistoryToolbar {...props} />),
    };
  }

  const writtenQueries = () =>
    replaceMock.mock.calls.map(([href]) =>
      new URL(href as string, "http://x").searchParams.get("q"),
    );

  it("still writes typed search after the debounce", () => {
    setUrl("?type=sokoBot");
    const { input } = renderToolbar();

    fireEvent.change(input(), { target: { value: "invoice" } });
    expect(replaceMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));

    expect(replaceMock).toHaveBeenLastCalledWith(
      "/history?type=sokoBot&q=invoice",
    );
  });

  it.each([
    ["the Search chip", "removeFilter(chip(searchLabel, invoice))"],
    ["Clear all", "clearAll"],
  ])("%s cancels pending typing so the search stays removed", (_, name) => {
    setUrl("?q=invoice&type=sokoBot");
    const { input, rerender } = renderToolbar();

    fireEvent.change(input(), { target: { value: "invoicex" } });
    fireEvent.click(screen.getByRole("button", { name }));
    setUrl(new URL(replaceMock.mock.calls[0][0], "http://x").search);
    rerender();
    act(() => vi.advanceTimersByTime(1000));

    expect(writtenQueries()).toEqual([null]);
    expect(input().value).toBe("");
  });

  it("follows Back to the earlier search after a reset", () => {
    setUrl("?q=invoice&type=sokoBot");
    const { input, rerender } = renderToolbar();

    fireEvent.click(
      screen.getByRole("button", {
        name: "removeFilter(chip(searchLabel, invoice))",
      }),
    );
    setUrl("?type=sokoBot");
    rerender();
    expect(input().value).toBe("");

    setUrl("?q=invoice&type=sokoBot");
    rerender();
    act(() => vi.advanceTimersByTime(1000));
    expect(input().value).toBe("invoice");
    expect(writtenQueries()).toEqual([null]);
  });
});
