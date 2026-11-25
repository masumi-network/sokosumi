import { type TaskListItem, TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListTree } from "lucide-react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskLinkTaskPickerDialog } from "./task-link-task-picker-dialog";

const { getTasksMock, useSessionMock } = vi.hoisted(() => ({
  getTasksMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => useSessionMock(),
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTasks: getTasksMock },
}));

const option = {
  id: "move-under",
  label: "Move under",
  title: "Move under a task",
  description: "Pick the task this one goes under.",
  icon: ListTree,
};

function taskItem(id: string, name: string): TaskListItem {
  return {
    id,
    name,
    status: TaskStatus.READY,
    parentTaskId: null,
  } as TaskListItem;
}

function tasksPage(tasks: TaskListItem[], nextCursor: string | null = null) {
  return {
    data: tasks,
    meta: {
      pagination: {
        cursor: null,
        limit: 20,
        total: tasks.length,
        nextCursor,
      },
    },
  };
}

let queryClient = new QueryClient();

function picker(
  open: boolean,
  onCloseAutoFocus: (event: Event) => void,
  { workspaceId = "ws-1" }: { workspaceId?: string } = {},
) {
  return (
    <QueryClientProvider client={queryClient}>
      <button type="button">Actions</button>
      <TaskLinkTaskPickerDialog
        taskId="task-1"
        workspaceId={workspaceId}
        open={open}
        onOpenChange={() => {}}
        selectedOption={open ? option : null}
        isLinkPending={false}
        onSelectTask={() => {}}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </QueryClientProvider>
  );
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  queryClient = new QueryClient();
  getTasksMock.mockReset();
  getTasksMock.mockResolvedValue(tasksPage([]));
  useSessionMock.mockReset();
  useSessionMock.mockReturnValue({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: null },
    },
  });
});

describe("TaskLinkTaskPickerDialog", () => {
  it("lets the caller choose where focus goes when it closes", async () => {
    // The menu item that opened it is gone, so Radix's default finds nothing.
    const focusActions = (event: Event) => {
      event.preventDefault();
      screen.getByRole("button", { name: "Actions", hidden: true }).focus();
    };
    const { rerender } = render(picker(true, focusActions));
    await screen.findByRole("dialog");

    rerender(picker(false, focusActions));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus(),
    );
  });

  it("shows the picker's title and what picking does", async () => {
    render(picker(true, () => {}));

    const heading = await screen.findByRole("heading", {
      name: "Move under a task",
    });
    expect(heading.closest(".sr-only")).toBeNull();
    expect(
      screen
        .getByText("Pick the task this one goes under.")
        .closest(".sr-only"),
    ).toBeNull();
  });

  it("blanks previous rows to loading while a new search loads", async () => {
    const betaSearch = Promise.withResolvers<ReturnType<typeof tasksPage>>();
    getTasksMock
      .mockResolvedValueOnce(tasksPage([taskItem("task-a", "Alpha task")]))
      .mockReturnValueOnce(betaSearch.promise);

    const user = userEvent.setup();
    render(picker(true, () => {}));
    expect(
      await screen.findByRole("option", { name: "Alpha task" }),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("combobox"), "Beta");

    expect(await screen.findByText("taskPickerLoading")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alpha task" })).toBeNull();

    await act(async () => {
      betaSearch.resolve(tasksPage([taskItem("task-b", "Beta task")]));
      await betaSearch.promise;
    });

    expect(
      await screen.findByRole("option", { name: "Beta task" }),
    ).toBeInTheDocument();
  });

  it("does not leave Load more stuck when a search interrupts an in-flight load-more", async () => {
    const staleLoadMore = Promise.withResolvers<ReturnType<typeof tasksPage>>();
    getTasksMock
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-a", "Alpha task")], "cursor-a1"),
      )
      .mockReturnValueOnce(staleLoadMore.promise)
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-b1", "Beta 1")], "cursor-b1"),
      )
      .mockResolvedValueOnce(tasksPage([taskItem("task-b2", "Beta 2")], null));

    const user = userEvent.setup();
    render(picker(true, () => {}));

    await screen.findByRole("option", { name: "Alpha task" });
    await user.click(
      screen.getByRole("option", { name: "taskPickerLoadMore" }),
    );

    // Type a new search before the first query's load-more resolves.
    await user.type(screen.getByRole("combobox"), "Beta");
    expect(
      await screen.findByRole("option", { name: "Beta 1" }),
    ).toBeInTheDocument();

    // Settle the superseded page-2 request after the search has loaded.
    await act(async () => {
      staleLoadMore.resolve(
        tasksPage([taskItem("task-stale", "Stale task")], null),
      );
      await staleLoadMore.promise;
    });

    expect(screen.queryByRole("option", { name: "Stale task" })).toBeNull();

    const loadMore = screen.getByRole("option", { name: "taskPickerLoadMore" });
    expect(loadMore).not.toHaveAttribute("aria-disabled", "true");

    await user.click(loadMore);

    expect(
      await screen.findByRole("option", { name: "Beta 2" }),
    ).toBeInTheDocument();
    expect(getTasksMock).toHaveBeenLastCalledWith({
      q: "Beta",
      cursor: "cursor-b1",
      limit: 20,
    });
  });

  it("keeps loaded rows visible when load-more fails and lets the user retry", async () => {
    getTasksMock
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-a", "Alpha task")], "cursor-a1"),
      )
      .mockRejectedValueOnce(new Error("page 2 failed"))
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-b", "Gamma task")], null),
      );

    const user = userEvent.setup();
    render(picker(true, () => {}));

    await screen.findByRole("option", { name: "Alpha task" });
    await user.click(
      screen.getByRole("option", { name: "taskPickerLoadMore" }),
    );

    expect(
      await screen.findByText("taskPickerLoadMoreError"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Alpha task" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("option", { name: "taskPickerLoadMore" }),
    );

    expect(
      await screen.findByRole("option", { name: "Gamma task" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("taskPickerLoadMoreError")).toBeNull();
  });

  it("isolates cached picker results per workspaceId", async () => {
    const wsTwoLoad = Promise.withResolvers<ReturnType<typeof tasksPage>>();
    getTasksMock
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-a", "Workspace A task")]),
      )
      .mockReturnValueOnce(wsTwoLoad.promise);

    const { rerender } = render(
      picker(true, () => {}, { workspaceId: "ws-a" }),
    );
    expect(
      await screen.findByRole("option", { name: "Workspace A task" }),
    ).toBeInTheDocument();

    rerender(picker(true, () => {}, { workspaceId: "ws-b" }));

    expect(await screen.findByText("taskPickerLoading")).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Workspace A task" }),
    ).toBeNull();

    await act(async () => {
      wsTwoLoad.resolve(tasksPage([taskItem("task-b", "Workspace B task")]));
      await wsTwoLoad.promise;
    });

    expect(
      await screen.findByRole("option", { name: "Workspace B task" }),
    ).toBeInTheDocument();
  });

  it("starts each opening from a fresh first page and never offers stale rows when the fresh read fails", async () => {
    const reopenFirstPage =
      Promise.withResolvers<ReturnType<typeof tasksPage>>();
    getTasksMock
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-old-1", "Old task 1")], "cursor-1"),
      )
      .mockResolvedValueOnce(
        tasksPage([taskItem("task-old-2", "Old task 2")], null),
      )
      .mockReturnValueOnce(reopenFirstPage.promise);

    const user = userEvent.setup();
    const { rerender } = render(picker(true, () => {}));

    await screen.findByRole("option", { name: "Old task 1" });
    await user.click(
      screen.getByRole("option", { name: "taskPickerLoadMore" }),
    );
    await screen.findByRole("option", { name: "Old task 2" });

    // Close and reopen: must not render previous opening's rows or refetch page 2.
    rerender(picker(false, () => {}));
    rerender(picker(true, () => {}));

    expect(await screen.findByText("taskPickerLoading")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old task 1" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Old task 2" })).toBeNull();

    await act(async () => {
      reopenFirstPage.reject(new Error("fresh read failed"));
      await reopenFirstPage.promise.catch(() => {});
    });

    expect(await screen.findByText("taskPickerError")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old task 1" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Old task 2" })).toBeNull();
    expect(getTasksMock).toHaveBeenCalledTimes(3);
  });

  it("isolates results per viewerId and rejects tasks from another workspace", async () => {
    const userTwoLoad = Promise.withResolvers<ReturnType<typeof tasksPage>>();
    getTasksMock
      .mockResolvedValueOnce(
        tasksPage([
          { ...taskItem("task-u1", "User 1 task"), workspaceId: "ws-1" },
        ]),
      )
      .mockReturnValueOnce(userTwoLoad.promise);

    const { rerender } = render(
      picker(true, () => {}, { workspaceId: "ws-1" }),
    );
    expect(
      await screen.findByRole("option", { name: "User 1 task" }),
    ).toBeInTheDocument();

    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user-2" },
        session: { activeOrganizationId: null },
      },
    });
    rerender(picker(true, () => {}, { workspaceId: "ws-1" }));
    expect(await screen.findByText("taskPickerLoading")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "User 1 task" })).toBeNull();

    await act(async () => {
      userTwoLoad.resolve(
        tasksPage([
          {
            ...taskItem("task-wrong-ws", "Wrong ws task"),
            workspaceId: "ws-other",
          },
        ]),
      );
      await userTwoLoad.promise;
    });

    expect(await screen.findByText("taskPickerError")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Wrong ws task" })).toBeNull();
  });

  it("loads a same-workspace page containing both Alice's private task and Bob's public task", async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user-alice" },
        session: { activeOrganizationId: "org-1" },
      },
    });
    getTasksMock.mockResolvedValueOnce(
      tasksPage([
        {
          ...taskItem("task-alice", "Alice private task"),
          workspaceId: "ws-1",
          ownerId: "user-alice",
        },
        {
          ...taskItem("task-bob", "Bob public task"),
          workspaceId: "ws-1",
          ownerId: "user-bob",
        },
      ]),
    );

    render(picker(true, () => {}, { workspaceId: "ws-1" }));

    expect(
      await screen.findByRole("option", { name: "Alice private task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Bob public task" }),
    ).toBeInTheDocument();
  });

  it("waits until the viewer session is known before loading tasks", async () => {
    useSessionMock.mockReturnValue({ data: null });

    render(picker(true, () => {}, { workspaceId: "ws-1" }));

    expect(await screen.findByText("taskPickerLoading")).toBeInTheDocument();
    expect(getTasksMock).not.toHaveBeenCalled();
  });
});
