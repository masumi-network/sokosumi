import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatDateWithYear: (date: string | Date) =>
      new Date(date).toISOString().split("T")[0],
  }),
}));

import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import {
  HISTORY_SEARCH_DEBOUNCE_MS,
  HISTORY_SEARCH_PAGE_SIZE,
} from "@/app/components/use-history-search-corpus";
import type { TransactionHistoryItem } from "@/lib/clients/generated/core/types.gen";

const labels = {
  dialogTitle: "Search transactions",
  dialogDescription: "Search your credit consumptions",
  searchPlaceholder: "Search transactions...",
  empty: "No transactions found",
  loading: "Loading transactions...",
  error: "Failed to load transactions",
  consumed: "Consumed",
  filesGroup: "Files",
  filesSeeAll: "See all files",
  filesFilenameMatch: "Filename match",
};

function createTaskItem(id: string, title: string): TransactionHistoryItem {
  return {
    id,
    kind: "task",
    title,
    consumedAt: new Date("2026-01-01T00:00:00.000Z"),
    description: null,
    credits: 2,
    projectId: null,
    owner: null,
    taskId: `task-for-${id}`,
    taskEventId: `event-for-${id}`,
  };
}

function createUnattributedItem(
  id: string,
  title: string,
): TransactionHistoryItem {
  return {
    id,
    kind: "unattributed",
    title,
    consumedAt: new Date("2026-09-27T00:00:00.000Z"),
    description: null,
    credits: 3,
    projectId: null,
    owner: null,
    bucketSource: null,
  };
}

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
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
    renderWithQuery(
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
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["job", "image", "task", "coworker", "sokoBot", "unattributed"],
      });
    });
  });

  it("requests owned scope for personal workspace users", async () => {
    renderWithQuery(
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
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["job", "image", "task", "coworker", "sokoBot", "unattributed"],
      });
    });
  });

  it("clears stale results while a new search is loading", async () => {
    let resolveSecondRequest:
      | ((value: { data: TransactionHistoryItem[] }) => void)
      | undefined;
    const secondRequest = new Promise<{ data: TransactionHistoryItem[] }>(
      (resolve) => {
        resolveSecondRequest = resolve;
      },
    );

    getHistoryMock
      .mockResolvedValueOnce({
        data: [createTaskItem("task-old", "Old query result")],
      })
      .mockImplementationOnce(() => secondRequest);

    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    renderWithQuery(
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

    await user.type(
      screen.getByPlaceholderText("Search transactions..."),
      "new",
    );

    await act(async () => {
      vi.advanceTimersByTime(HISTORY_SEARCH_DEBOUNCE_MS);
    });

    expect(screen.queryByText("Old query result")).not.toBeInTheDocument();
    expect(screen.getByText("Loading transactions...")).toBeInTheDocument();

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

  it("passes every consumption source when searching", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId="org-1"
        labels={labels}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("Search transactions..."),
      "new",
    );

    await act(async () => {
      vi.advanceTimersByTime(HISTORY_SEARCH_DEBOUNCE_MS);
    });

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenLastCalledWith({
        q: "new",
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["job", "image", "task", "coworker", "sokoBot", "unattributed"],
      });
    });
  });

  it("does not navigate for a consumption with no page behind it", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    getHistoryMock.mockImplementation(async () => ({
      data: [createUnattributedItem("tx-9", "Credit consumption")],
    }));

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    await user.click(await screen.findByText("Credit consumption"));

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to the page behind a task consumption", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    getHistoryMock.mockImplementation(async () => ({
      data: [createTaskItem("tx-10", "Summarise the report")],
    }));

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    await user.click(await screen.findByText("Summarise the report"));

    expect(pushMock).toHaveBeenCalledWith("/tasks/task-for-tx-10");
  });
});
