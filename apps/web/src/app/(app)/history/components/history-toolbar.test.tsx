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
  HistoryViewFilters: () => <div data-testid="history-view-filters" />,
}));

import type { HistoryStatus } from "@/app/history/utils/history-filters";

import { HistoryToolbar } from "./history-toolbar";

describe("HistoryToolbar", () => {
  it("hides the page search input on mobile so header search owns filtering", () => {
    const { container } = render(
      <HistoryToolbar
        activeOrganizationId={null}
        projectOptions={[]}
        labels={{
          search: {
            placeholder: "Search history",
            clear: "Clear",
          },
          filters: {
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
          },
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
});
