import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";

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
  scopeOwned: "My history",
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
    [SokosumiJobStatus.STARTED]: "Hiring",
    [SokosumiJobStatus.RESULT_PENDING]: "Result missing",
    [SokosumiJobStatus.PAYMENT_PENDING]: "Hiring",
    [SokosumiJobStatus.PAYMENT_FAILED]: "Hiring failed",
    [SokosumiJobStatus.REFUND_PENDING]: "Refund requested",
    [SokosumiJobStatus.REFUND_RESOLVED]: "Refunded",
    [SokosumiJobStatus.DISPUTE_PENDING]: "Dispute pending",
    [SokosumiJobStatus.DISPUTE_RESOLVED]: "Dispute resolved",
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

  it("shows scope and history filter sections in workspace context", () => {
    const props = renderHistoryViewFilters("org-1");

    expect(props.buttonLabel).toBe("Filters");
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "type",
      "status",
      "project",
    ]);
  });

  it("only hides the scope section in personal context", () => {
    const props = renderHistoryViewFilters(null);

    expect(props.sections.map((section) => section.id)).toEqual([
      "type",
      "status",
      "project",
    ]);
  });

  it("shows job-only statuses in the status filter when no type is selected", () => {
    const props = renderHistoryViewFilters("org-1");
    const statusSection = props.sections.find(
      (section) => section.id === "status",
    );

    expect(statusSection?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: SokosumiJobStatus.PAYMENT_PENDING,
          label: "Hiring",
        }),
        expect.objectContaining({
          value: SokosumiJobStatus.DISPUTE_RESOLVED,
          label: "Dispute resolved",
        }),
      ]),
    );
  });
});
