import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getHistoryMock, pushMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  pushMock: vi.fn(),
}));

// Projects and Channels read the session and rooms; covered in go-to tests.
// Here they answer at once with nothing, so only this file's groups count.
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useScopeProjects: () => ({ rows: [] }),
}));
vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRoomsRead: () => ({ rooms: [], failed: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getHistory: getHistoryMock,
    listTaskSchedules: async () => ({ data: [] }),
    getTaskScheduleAssignees: async () => ({
      data: { coworkers: [], sokoBot: null },
    }),
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
    formatDateWithYear: (date: string | Date) =>
      new Date(date).toISOString().split("T")[0],
  }),
}));

import type { HistoryItem } from "@sokosumi/core-client";
import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import {
  HISTORY_SEARCH_DEBOUNCE_MS,
  HISTORY_SEARCH_PAGE_SIZE,
} from "@/app/components/use-history-search-corpus";

const labels = {
  dialogTitle: "Search history",
  dialogDescription: "Search across tasks and jobs",
  searchPlaceholder: "Search history...",
  empty: "No history found",
  loading: "Loading history...",
  error: "Failed to load history",
  created: "Created",
  filesGroup: "Files",
  filesSeeAll: "See all files",
  tasksSeeAll: (query: string) => `Search tasks and results for ${query}`,
  filesFilenameMatch: "Filename match",
  peopleGroup: "People",
  copyEmail: (email: string) => `Copy ${email}`,
  emailCopied: "Email copied",
  emailCopyFailed: "Failed to copy email",
  mentionInTask: (name: string) => `Mention ${name} in a new task`,
  tagsGroup: "Tags",
  tagTasksGroup: (tag: string) => `Tasks tagged ${tag}`,
  tagsError: "Couldn't load tags",
  tagTasksError: "Couldn't load these tasks",
  projectsGroup: "Projects",
  channelsGroup: "Channels",
  schedulesGroup: "Schedules",
  coworkersGroup: "Coworkers",
  newTask: "New task",
};

function createTaskItem(id: string, title: string): HistoryItem {
  return {
    id,
    kind: "task",
    title,
    status: "DRAFT",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    description: null,
    credits: null,
    projectId: null,
    coworkerId: null,
    sokoBotId: null,
    owner: null,
  };
}

function createImageItem(id: string, title: string): HistoryItem {
  return {
    id,
    assetId: id,
    kind: "image",
    title,
    // The literal Core sends. An image has no lifecycle of its own, and
    // `JobStatusBadge` has no case for this value.
    status: "active",
    createdAt: new Date("2026-09-27T00:00:00.000Z"),
    archivedAt: null,
    description: "fal-ai/flux-2-pro \u00b7 3 credits",
    credits: 3,
    projectId: "project-7",
    modelLabel: "FLUX.2 Pro",
    owner: null,
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

  describe("results height under the on-screen keyboard", () => {
    let phone = true;
    const viewport = Object.assign(new EventTarget(), {
      height: 300,
      offsetTop: 0,
    });

    beforeEach(() => {
      phone = true;
      viewport.height = 300;
      vi.stubGlobal("visualViewport", viewport);
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(width < 40rem)" && phone,
      }));
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        top: 80,
      } as DOMRect);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function renderList() {
      renderWithQuery(
        <HistorySearchDialog
          open
          onOpenChange={vi.fn()}
          activeOrganizationId={null}
          labels={labels}
        />,
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog.className).toMatch(/max-sm:top-/);
      return dialog.querySelector<HTMLElement>("[cmdk-list]");
    }

    function resizeTo(height: number) {
      viewport.height = height;
      act(() => {
        viewport.dispatchEvent(new Event("resize"));
      });
    }

    it("ends the list above the keyboard on phones", () => {
      const list = renderList();
      // 300px visible, list starts at 80px, 8px gap above the keyboard.
      expect(list?.style.maxHeight).toBe("212px");

      // Keyboard closes: back to the usual 300px cap.
      resizeTo(812);
      expect(list?.style.maxHeight).toBe("300px");
    });

    it("never grows past the visible space, however little is left", () => {
      viewport.height = 145;
      const list = renderList();

      expect(list?.style.maxHeight).toBe("57px");
    });

    it("leaves the list alone outside the phone layout", () => {
      phone = false;
      const list = renderList();

      expect(list?.style.maxHeight).toBe("");

      // Narrowing to the phone layout starts tracking the keyboard.
      phone = true;
      resizeTo(300);
      expect(list?.style.maxHeight).toBe("212px");
    });
  });

  describe("focus when search closes", () => {
    function ControlledDialog({
      onCloseAutoFocus,
    }: {
      onCloseAutoFocus: (event: Event) => void;
    }) {
      const [open, setOpen] = useState(true);
      return (
        <HistorySearchDialog
          open={open}
          onOpenChange={setOpen}
          onCloseAutoFocus={onCloseAutoFocus}
          activeOrganizationId={null}
          labels={labels}
        />
      );
    }

    it("returns focus to the opener when dismissed", async () => {
      const onCloseAutoFocus = vi.fn();
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime.bind(vi),
      });
      renderWithQuery(<ControlledDialog onCloseAutoFocus={onCloseAutoFocus} />);

      await user.keyboard("{Escape}");

      await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
    });

    it("leaves focus to the new page when a result navigates", async () => {
      const onCloseAutoFocus = vi.fn();
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime.bind(vi),
      });
      renderWithQuery(<ControlledDialog onCloseAutoFocus={onCloseAutoFocus} />);

      await user.click(await screen.findByText("Old query result"));

      expect(pushMock).toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(onCloseAutoFocus).not.toHaveBeenCalled();
    });
  });

  it("requests owned scope for organization users", async () => {
    await act(async () =>
      renderWithQuery(
        <HistorySearchDialog
          open
          onOpenChange={vi.fn()}
          activeOrganizationId="org-1"
          labels={labels}
        />,
      ),
    );

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenCalledWith({
        q: undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["task", "job", "image"],
      });
    });
  });

  it("requests owned scope for personal workspace users", async () => {
    await act(async () =>
      renderWithQuery(
        <HistorySearchDialog
          open
          onOpenChange={vi.fn()}
          activeOrganizationId={null}
          labels={labels}
        />,
      ),
    );

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenCalledWith({
        q: undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["task", "job", "image"],
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

    await user.type(screen.getByPlaceholderText("Search history..."), "new");

    await act(async () => {
      vi.advanceTimersByTime(HISTORY_SEARCH_DEBOUNCE_MS);
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

  it("opens the Tasks search, results included, for what was typed", async () => {
    getHistoryMock.mockResolvedValue({ data: [] });
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

    expect(
      screen.queryByText(/Search tasks and results/),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText("Search history..."),
      "50% plan",
    );
    await user.click(
      await screen.findByText("Search tasks and results for 50% plan"),
    );

    expect(pushMock).toHaveBeenCalledWith("/tasks?q=50%25%20plan");
  });

  it("passes every history kind when searching", async () => {
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

    await user.type(screen.getByPlaceholderText("Search history..."), "new");

    await act(async () => {
      vi.advanceTimersByTime(HISTORY_SEARCH_DEBOUNCE_MS);
    });

    await waitFor(() => {
      expect(getHistoryMock).toHaveBeenLastCalledWith({
        q: "new",
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: "owned",
        types: ["task", "job", "image"],
      });
    });
  });

  /**
   * The palette had its own copy of the status decision.
   *
   * `history-list-item.tsx` got the image branch and this one did not, so every
   * generated image in the palette rendered a badge reading "Unknown" — the
   * label `JobStatusBadge` falls back to for a status it has no case for.
   */
  it("shows no status badge on an image result", async () => {
    getHistoryMock.mockImplementation(async () => ({
      data: [createImageItem("asset-9", "A calm product shot")],
    }));

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    expect(await screen.findByText("A calm product shot")).toBeInTheDocument();
    expect(screen.queryByTestId("job-status-badge")).toBeNull();
    expect(screen.queryByTestId("task-status-badge")).toBeNull();
  });

  it("still badges a job result", async () => {
    // The guard for the guard: returning null for everything would also make
    // the assertion above pass.
    getHistoryMock.mockImplementation(async () => ({
      data: [
        {
          ...createTaskItem("job-1", "Analyze data"),
          kind: "job" as const,
          status: "completed",
          agentId: "agent-1",
          agentName: null,
          agentIcon: null,
        } as unknown as HistoryItem,
      ],
    }));

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={null}
        labels={labels}
      />,
    );

    expect(await screen.findByText("Analyze data")).toBeInTheDocument();
    expect(screen.getByTestId("job-status-badge")).toBeInTheDocument();
  });

  /**
   * The defect this whole task was opened for, at the surface that shows it:
   * `history.sortAt` was the source row's `updatedAt`, so a backfill on an
   * unrelated column made every old result read "Yesterday". The palette now
   * prints the entity's creation date, which is what its own card shows.
   */
  it("prints the result's creation date, not a relative label", async () => {
    getHistoryMock.mockImplementation(async () => ({
      data: [createTaskItem("task-old", "Summarise the report")],
    }));

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={() => {}}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(await screen.findByText("Summarise the report")).toBeInTheDocument();
    // The mocked formatter renders an ISO date, so a relative label could not
    // produce this string.
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
  });

  it("labels the date as created, not updated", async () => {
    getHistoryMock.mockImplementation(async () => ({
      data: [createTaskItem("task-old", "Summarise the report")],
    }));

    renderWithQuery(
      <HistorySearchDialog
        open
        onOpenChange={() => {}}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(await screen.findByTitle("Created")).toBeInTheDocument();
  });
});
