import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/history",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 300,
  }),
}));

vi.mock("./history-view-filters", () => ({
  HistoryViewFilters: () => (
    <button type="button" data-testid="history-view-filters">
      Filters
    </button>
  ),
  HistoryActiveFilters: () => null,
}));

vi.mock("./history-export-menu", () => ({
  HistoryExportMenu: () => <button type="button">Export</button>,
}));

import { HistoryToolbar } from "./history-toolbar";

const filterLabels = {
  title: "Filters",
  searchPlaceholder: "Filter",
  emptyResults: "Empty",
  all: "All",
  scopeLabel: "Scope",
  scopeOwned: "Owned",
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
};

describe("HistoryToolbar", () => {
  it("focuses the page filter with Ctrl+F in the mobile toolbar", () => {
    render(
      <HistoryToolbar
        activeOrganizationId={null}
        filters={{
          q: null,
          scope: "owned",
          type: null,
          projectId: null,
          taskId: null,
        }}
        projectOptions={[]}
        resultsCountLabel="3 results found"
        labels={{
          search: {
            placeholder: "Search transactions",
            clear: "Clear",
          },
          filters: filterLabels,
        }}
      />,
    );

    const field = screen.getByRole("searchbox", {
      name: "Search transactions",
    });
    expect(field.closest(".hidden")).toBeNull();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(field).toHaveFocus();
    expect(screen.getByTestId("history-view-filters")).toBeInTheDocument();
  });

  it("shows the results count on the left and filter on the right on mobile", () => {
    const { container } = render(
      <HistoryToolbar
        activeOrganizationId={null}
        filters={{
          q: null,
          scope: "owned",
          type: null,
          projectId: null,
          taskId: null,
        }}
        projectOptions={[]}
        resultsCountLabel="3 results found"
        labels={{
          search: {
            placeholder: "Search transactions",
            clear: "Clear",
          },
          filters: filterLabels,
        }}
      />,
    );

    // First row of the toolbar; active filter chips sit on their own row below.
    const toolbar = container.firstElementChild?.firstElementChild;
    expect(toolbar).not.toBeNull();

    const resultsLabel = screen.getByText("3 results found");
    expect(resultsLabel.className).toMatch(/md:hidden/);

    const filterWrapper = screen.getByTestId(
      "history-view-filters",
    ).parentElement;
    const actionGroup = filterWrapper?.parentElement;
    expect(actionGroup).toBe(toolbar?.lastElementChild);
    expect(actionGroup?.firstElementChild).toContainElement(
      screen.getByRole("searchbox"),
    );
    expect(actionGroup?.lastElementChild).toBe(filterWrapper);
    expect(toolbar?.firstElementChild).toBe(resultsLabel);
  });
});
