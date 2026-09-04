import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
}));

import type { HistoryStatus } from "@/app/history/utils/history-filters";

import { HistoryToolbar } from "./history-toolbar";

const filterLabels = {
  title: "Filters",
  searchPlaceholder: "Filter",
  emptyResults: "Empty",
  all: "All",
  scopeLabel: "Scope",
  scopeOwned: "Owned",
  scopeWorkspace: "Workspace",
  typeLabel: "Type",
  statusLabel: "Status",
  projectLabel: "Project",
  typeOptions: {
    task: "Task",
    job: "Job",
  },
  statusOptions: {
    archived: "Archived",
  } as Record<HistoryStatus, string>,
};

describe("HistoryToolbar", () => {
  it("hides the page search input on mobile so header search owns filtering", () => {
    const { container } = render(
      <HistoryToolbar
        activeOrganizationId={null}
        projectOptions={[]}
        resultsCountLabel="3 results found"
        labels={{
          search: {
            placeholder: "Search history",
            clear: "Clear",
          },
          filters: filterLabels,
        }}
      />,
    );

    const searchSlot = container.querySelector(".hidden.md\\:block");
    expect(searchSlot).not.toBeNull();
    expect(
      screen.getByPlaceholderText("Search history").closest(".hidden"),
    ).toBeTruthy();
    expect(screen.getByTestId("history-view-filters")).toBeInTheDocument();
  });

  it("shows the results count on the left and filter on the right on mobile", () => {
    const { container } = render(
      <HistoryToolbar
        activeOrganizationId={null}
        projectOptions={[]}
        resultsCountLabel="3 results found"
        labels={{
          search: {
            placeholder: "Search history",
            clear: "Clear",
          },
          filters: filterLabels,
        }}
      />,
    );

    const toolbar = container.firstElementChild;
    expect(toolbar).not.toBeNull();

    const resultsLabel = screen.getByText("3 results found");
    expect(resultsLabel.className).toMatch(/md:hidden/);

    const filterWrapper = screen.getByTestId(
      "history-view-filters",
    ).parentElement;
    expect(filterWrapper?.className).toMatch(/ml-auto/);

    expect(
      Array.from(toolbar?.children ?? []).indexOf(resultsLabel),
    ).toBeLessThan(
      Array.from(toolbar?.children ?? []).indexOf(filterWrapper as Element),
    );
  });
});
