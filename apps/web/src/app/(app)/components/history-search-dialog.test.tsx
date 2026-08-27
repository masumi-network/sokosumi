import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getHistoryMock, pushMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getHistory: getHistoryMock,
  },
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => <span data-testid="agent-icon" />,
}));

vi.mock("@/app/tasks/components/task-status-badge", () => ({
  TaskStatusBadge: () => <span data-testid="task-status-badge" />,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: () => <span data-testid="job-status-badge" />,
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: (date: string | Date) =>
      new Date(date).toISOString().split("T")[0],
  }),
}));

import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";

const labels = {
  dialogTitle: "Search history",
  dialogDescription: "Search across tasks and jobs",
  searchPlaceholder: "Search history...",
  empty: "No history found",
  loading: "Loading history...",
  error: "Failed to load history",
  updated: "Updated",
};

function createTaskItem(id: string, title: string): HistoryItem {
  return {
    id,
    kind: "task",
    title,
    status: "DRAFT",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    description: null,
    credits: null,
    projectId: null,
    coworkerId: null,
    owner: null,
  };
}

describe("HistorySearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getHistoryMock.mockImplementation(async ({ q }: { q?: string } = {}) => ({
      data:
        q === "new"
          ? [createTaskItem("task-new", "New query result")]
          : [createTaskItem("task-old", "Old query result")],
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests owned scope for organization users", async () => {
    render(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId="org-1"
        labels={labels}
      />,
    );

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenCalledWith({
        q: undefined,
        limit: 50,
        scope: "owned",
        types: ["task", "job"],
      });
    });
  });

  it("requests owned scope for personal workspace users", async () => {
    render(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenCalledWith({
        q: undefined,
        limit: 50,
        scope: "owned",
        types: ["task", "job"],
      });
    });
  });

  it("clears stale results while a new search is loading", async () => {
    let resolveSecondRequest:
      | ((value: { data: HistoryItem[] }) => void)
      | undefined;
    const secondRequest = new Promise<{ data: HistoryItem[] }>((resolve) => {
      resolveSecondRequest = resolve;
    });

    getHistoryMock
      .mockResolvedValueOnce({
        data: [createTaskItem("task-old", "Old query result")],
      })
      .mockImplementationOnce(() => secondRequest);

    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Old query result")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Search history..."), "new");

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByText("Old query result")).not.toBeInTheDocument();
    expect(screen.getByText("Loading history...")).toBeInTheDocument();

    await act(async () => {
      resolveSecondRequest?.({
        data: [createTaskItem("task-new", "New query result")],
      });
      await secondRequest;
    });

    await waitFor(() => {
      expect(screen.getByText("New query result")).toBeInTheDocument();
    });
  });

  it("passes task and job types when searching", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    render(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId="org-1"
        labels={labels}
      />,
    );

    await user.type(screen.getByPlaceholderText("Search history..."), "new");

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenLastCalledWith({
        q: "new",
        limit: 50,
        scope: "owned",
        types: ["task", "job"],
      });
    });
  });
});
