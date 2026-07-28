import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getHistoryMock, getCoworkersMock, pushMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  getCoworkersMock: vi.fn(),
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
    getCoworkers: getCoworkersMock,
  },
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => <span data-testid="agent-icon" />,
}));

vi.mock("@/components/chat/chat-model-icon", () => ({
  ChatModelIcon: ({
    modelId,
    modelName,
  }: {
    modelId: string;
    modelName?: string;
  }) => (
    <span data-testid="chat-model-icon">{`${modelId}:${modelName ?? ""}`}</span>
  ),
}));

vi.mock("@/app/tasks/components/task-status-badge", () => ({
  TaskStatusBadge: () => <span data-testid="task-status-badge" />,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: () => <span data-testid="job-status-badge" />,
}));

vi.mock("@/app/history/components/conversation-status-badge", () => ({
  ConversationStatusBadge: () => (
    <span data-testid="conversation-status-badge" />
  ),
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
  dialogDescription: "Search across tasks, jobs, and conversations",
  searchPlaceholder: "Search history...",
  empty: "No history found",
  loading: "Loading history...",
  error: "Failed to load history",
  updated: "Updated",
  kind: {
    task: "Task",
    job: "Job",
    conversation: "Conversation",
  },
  conversationStatus: {
    active: "Active",
    archived: "Archived",
  },
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
    getCoworkersMock.mockResolvedValue({
      data: [
        {
          id: "coworker-1",
          slug: "elena",
          name: "Elena",
          image: "https://example.com/elena.webp",
        },
      ],
    });
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

  it("loads coworkers when the dialog opens", async () => {
    render(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    await waitFor(() => {
      expect(getCoworkersMock).toHaveBeenCalledTimes(1);
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
