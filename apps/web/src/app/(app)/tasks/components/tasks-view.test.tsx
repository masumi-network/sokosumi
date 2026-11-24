import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  type RenderOptions,
  render as renderWithoutUrl,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import {
  Activity,
  type ComponentProps,
  cloneElement,
  type ReactNode,
  StrictMode,
  Suspense,
  startTransition,
  use,
  useState,
} from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMoreTasksColumn, loadMoreTasksList } from "@/app/tasks/actions";
import {
  TASKS_BOARD_REFRESH_DEBOUNCE_MS,
  TASKS_BOARD_REFRESH_MAX_WAIT_MS,
} from "@/app/tasks/constants";
import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import {
  markTaskArchived,
  settleTaskArchive,
  unmarkTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";
import type { TasksFilters } from "@/app/tasks/utils/tasks-filters";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { parseTasksDensity } from "@/lib/ui-preferences/tasks-density";
import { TasksView } from "./tasks-view";

const {
  dndContextPropsSpy,
  openCreateTaskMock,
  openNewTaskWizardMock,
  pushMock,
  refreshMock,
  replaceMock,
  searchParamsRef,
  showCalendarClientUpgradeModalMock,
} = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams() },
  dndContextPropsSpy: vi.fn(),
  openCreateTaskMock: vi.fn(),
  openNewTaskWizardMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  showCalendarClientUpgradeModalMock: vi.fn(),
}));

/**
 * The board is driven through the real `handleDragEnd`: dnd-kit is an external
 * pointer system, so the test hands the component the drop it would produce and
 * reads the resulting optimistic state off the board it renders.
 */
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => {
    dndContextPropsSpy(props);
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  PointerSensor: {},
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock("./kanban-board", () => ({
  KanbanBoard: ({
    tasks,
    compact,
    columnFooterById,
    columnHiddenCountById,
  }: {
    tasks: TaskWithCoworker[];
    compact: boolean;
    columnFooterById: Partial<Record<KanbanColumnId, ReactNode>>;
    columnHiddenCountById?: Partial<Record<KanbanColumnId, number>>;
  }) => (
    <div
      data-testid="board-density"
      data-compact={compact}
      data-done-hidden={columnHiddenCountById?.done ?? 0}
      data-todo-hidden={columnHiddenCountById?.todo ?? 0}
    >
      {tasks.map((task) => (
        <div
          key={task.id}
          data-testid={`board-card-${task.id}`}
          data-column={task.columnId}
          data-status={task.status}
          data-status-since={task.statusSince}
        />
      ))}
      {Object.entries(columnFooterById).map(([columnId, footer]) => (
        <div key={columnId}>{footer}</div>
      ))}
    </div>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    replace: replaceMock,
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({
    showCalendarClientUpgradeModal: showCalendarClientUpgradeModalMock,
  }),
}));

vi.mock("@/lib/actions/task/action", () => ({
  setTaskStatusFromDrag: vi.fn(),
}));

vi.mock("@/app/tasks/actions", () => ({
  loadMoreTasksColumn: vi.fn(),
  loadMoreTasksList: vi.fn(),
  exportTasks: vi.fn(),
  previewTasksExport: vi.fn(async () => ({ rows: [], matched: 0 })),
  saveTasksView: vi.fn(async () => true),
}));

vi.mock("./create-task-modal", () => ({
  CreateTaskModal: () => null,
  CreateTaskModalProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useCreateTaskModal: () => ({
    handleOpen: openCreateTaskMock,
    handleOpenWithDefaults: vi.fn(),
  }),
}));

// TasksView reads the search query through nuqs.
function render(ui: React.ReactElement, options?: RenderOptions) {
  return renderWithoutUrl(ui, { wrapper: NuqsTestingAdapter, ...options });
}

let focusedFilters = false;
vi.mock("./tasks-view-filters", async (importOriginal) => ({
  // The real focus helper: clearing a filter moves focus with it.
  focusToolbarControl: (
    await importOriginal<typeof import("./tasks-view-filters")>()
  ).focusToolbarControl,
  // The filter row places the view options menu after Filters, so the stub
  // does too.
  TasksViewFilters: ({
    display,
  }: {
    display?: React.ReactNode | ((activeFilters: string[]) => React.ReactNode);
  }) => (
    <>
      <input type="search" aria-label="Search tasks" />
      <span data-filters-menu>
        <button
          type="button"
          onFocus={() => {
            focusedFilters = true;
          }}
        >
          Filters
        </button>
      </span>
      {typeof display === "function" ? display([]) : display}
    </>
  ),
}));
vi.mock("./task-list-view", () => ({
  TaskListView: ({
    tasks,
    compact,
    footer,
  }: {
    tasks: TaskWithCoworker[];
    compact: boolean;
    footer?: ReactNode;
  }) => (
    <div data-testid="list-density" data-compact={compact}>
      {tasks.map((task) => (
        <div
          key={task.id}
          data-testid={`list-row-${task.id}`}
          data-status={task.status}
        />
      ))}
      {footer}
    </div>
  ),
}));
vi.mock("./task-list-item", () => ({
  TaskListItem: ({ compact }: { compact: boolean }) => (
    <div data-testid="list-overlay" data-compact={compact} />
  ),
}));
vi.mock("./task-card", () => ({
  TaskCard: ({ compact }: { compact: boolean }) => (
    <div data-testid="board-overlay" data-compact={compact} />
  ),
}));
vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: openNewTaskWizardMock,
  }),
}));
vi.mock("@/app/components/list-mobile-create-fab", () => ({
  ListMobileCreateFab: ({
    ariaLabel,
    onOpen,
  }: {
    ariaLabel: string;
    onOpen: () => void;
  }) => <button type="button" aria-label={ariaLabel} onClick={onOpen} />,
}));

const TASK: TaskWithCoworker = {
  id: "task-1",
  name: "Weekly report",
  status: TaskStatus.DRAFT,
  identifier: null,
  priority: "NONE",
  visibility: "PUBLIC",
  ownerId: "user-1",
  owner: { id: "user-1", name: "Ada", email: "ada@example.com" },
  project: null,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:00:00.000Z",
  jobsCount: 0,
  commentsCount: 0,
  participants: [],
  columnId: "backlog",
  events: [],
  agents: [],
  assignee: { id: "coworker-1", name: "Soko", kind: "coworker" },
} as TaskWithCoworker;

const CANCELED_TASK: TaskWithCoworker = {
  ...TASK,
  status: TaskStatus.CANCELED,
  columnId: "done",
};

const labels = {
  filters: {
    title: "Filters",
    searchPlaceholder: "Search",
    emptyResults: "No results",
    all: "All",
    scopeLabel: "Scope",
    scopeOwned: "Owned",
    assignedToMe: "My tasks",
    scopeWorkspace: "Workspace",
    coworkerLabel: "Coworker",
    statusLabel: "Status",
    visibilityLabel: "Visibility",
    visibilityPrivate: "Private",
    statusOptions: {} as Record<TaskStatus, string>,
  },
  columns: {
    backlog: "Backlog",
    todo: "To do",
    "in-progress": "In progress",
    "input-required": "Input required",
    done: "Done",
  } as Record<KanbanColumnId, string>,
  display: {
    button: "Display",
    layout: "Layout",
    list: "List",
    board: "Board",
    density: "Density",
    normal: "Normal",
    compact: "Compact",
    sortBy: "Sort by",
    sortOptions: {
      updatedAt: "Last updated",
      createdAt: "Newest",
      priority: "Priority",
      dueOn: "Due date",
    },
    showSubtasks: "Show subtasks",
  },
  listPlaceholder: "No tasks",
  loadMore: "Load more",
  dragError: "Could not update the task",
  loadMoreError: "Could not load more",
  reopenToReady: { commentRequired: "A comment is required" },
} satisfies ComponentProps<typeof TasksView>["labels"];

const EMPTY_FILTERS: TasksFilters = {
  scope: "owned",
  assigneeId: null,
  assigneeSokoBotId: null,
  assigneeUserId: null,
  status: null,
  projectId: null,
  visibility: null,
  stuck: false,
};

function renderBoard(
  tasks: TaskWithCoworker[] = [TASK],
  defaultDensity?: ComponentProps<typeof TasksView>["defaultDensity"],
) {
  return render(boardView(tasks, defaultDensity));
}

function boardView(
  tasks: TaskWithCoworker[],
  defaultDensity?: ComponentProps<typeof TasksView>["defaultDensity"],
  doneCursor: string | null = null,
  doneHidden = 0,
) {
  return (
    <TasksView
      tasks={tasks}
      listNextCursor={null}
      columnHiddenCountById={{
        backlog: 0,
        todo: 0,
        "in-progress": 0,
        "input-required": 0,
        done: doneHidden,
      }}
      columnNextCursorById={
        {
          backlog: null,
          todo: null,
          "in-progress": null,
          "input-required": null,
          done: doneCursor,
        } as Record<KanbanColumnId, string | null>
      }
      coworkerOptions={[]}
      projectOptions={[]}
      userId={null}
      activeOrganizationId={null}
      initialFilters={EMPTY_FILTERS}
      defaultViewMode="board"
      defaultDensity={defaultDensity}
      canCreateTask
      labels={labels}
    />
  );
}

it("applies density from the view options menu to board and list and restores the saved preference", async () => {
  document.cookie = "tasks_density=; max-age=0; path=/";
  const user = userEvent.setup();
  const { unmount } = renderBoard();
  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("radio", { name: "Compact" }));
  expect(screen.getByTestId("board-density")).toHaveAttribute(
    "data-compact",
    "true",
  );
  expect(document.cookie).toContain("tasks_density=compact");

  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("radio", { name: "List" }));
  expect(screen.getByTestId("list-density")).toHaveAttribute(
    "data-compact",
    "true",
  );

  const saved = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("tasks_density="))
    ?.split("=")[1];
  unmount();
  renderBoard([TASK], parseTasksDensity(saved) ?? undefined);
  expect(screen.getByTestId("board-density")).toHaveAttribute(
    "data-compact",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Display" }));
  expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Normal" }));
  expect(screen.getByTestId("board-density")).toHaveAttribute(
    "data-compact",
    "false",
  );
  expect(document.cookie).toContain("tasks_density=normal");
  document.cookie = "tasks_density=; max-age=0; path=/";
});

// The toolbar has no Archived button, so the view options menu is the way there.
it("reaches archived Tasks from the view options menu", async () => {
  const user = userEvent.setup();
  render(boardView([TASK]));
  expect(screen.queryByRole("link", { name: "link" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Display" }));

  expect(await screen.findByRole("link", { name: "link" })).toHaveAttribute(
    "href",
    "/tasks/archived",
  );
});

// Export as CSV opens a dialog from a menu item that is gone once the menu
// closes, so closing the dialog must hand focus back to the menu button.
it("returns focus to the view options button when the export dialog closes", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      {boardView([TASK])}
    </QueryClientProvider>,
  );
  const menuButton = screen.getByRole("button", { name: "Display" });

  await user.click(menuButton);
  await user.click(await screen.findByRole("button", { name: "button" }));
  await user.click(await screen.findByRole("button", { name: "cancel" }));

  await waitFor(() => expect(menuButton).toHaveFocus());
});

// New task lives in the sidebar header, so the Tasks page shows it once; the
// phone, which has no sidebar header in view, keeps its create button.
it("has no toolbar New task button, and keeps the phone create button", () => {
  const { unmount } = render(
    <OrganizationSeatContext value={true}>
      {boardView([TASK])}
    </OrganizationSeatContext>,
  );
  expect(screen.queryByRole("button", { name: "newTask" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "createTaskFab" }),
  ).toBeInTheDocument();
  unmount();

  render(
    <OrganizationSeatContext value={true}>
      {cloneElement(boardView([TASK]), { canCreateTask: false })}
    </OrganizationSeatContext>,
  );
  expect(screen.queryByRole("button", { name: "createTaskFab" })).toBeNull();
});

/** Drives the board's real drop handler with the event dnd-kit would emit. */
async function dropOnTodo(taskId: string, fromColumn: KanbanColumnId) {
  const handleDragEnd = await waitFor(() => {
    const onDragEnd = dndContextPropsSpy.mock.calls.at(-1)?.[0]?.onDragEnd as
      | ((event: DragEndEvent) => void)
      | undefined;
    if (!onDragEnd) throw new Error("Expected a mounted DndContext");
    return onDragEnd;
  });

  const rect = new DOMRect();
  await act(async () => {
    handleDragEnd({
      activatorEvent: new Event("pointerdown"),
      active: {
        id: taskId,
        data: { current: { columnId: fromColumn } },
        rect: { current: { initial: rect, translated: rect } },
      },
      collisions: null,
      delta: { x: 0, y: 0 },
      over: {
        id: "todo",
        rect,
        disabled: false,
        data: { current: {} },
      },
    });
  });
}

function boardCard(taskId: string) {
  return screen.getByTestId(`board-card-${taskId}`);
}

describe("TasksView board drag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a task rejected with status_not_selectable and says why", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    renderBoard();

    await dropOnTodo("task-1", "backlog");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Errors.updateStatus"),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-column", "backlog");
    expect(boardCard("task-1")).toHaveAttribute(
      "data-status",
      TaskStatus.DRAFT,
    );
    expect(showCalendarClientUpgradeModalMock).not.toHaveBeenCalled();
  });

  it("still sends a stale client to the reload modal", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });
    renderBoard();

    await dropOnTodo("task-1", "backlog");

    await waitFor(() =>
      expect(showCalendarClientUpgradeModalMock).toHaveBeenCalledOnce(),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-column", "backlog");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reopens a person's canceled Task on drop, with no comment", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: true,
    } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
    renderBoard([
      {
        ...CANCELED_TASK,
        assignee: { id: "user-2", name: "Ada", kind: "user" },
      },
    ]);

    await dropOnTodo("task-1", "done");

    await waitFor(() =>
      expect(setTaskStatusFromDrag).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          desiredStatus: TaskStatus.READY,
        }),
      ),
    );
    expect(screen.queryByLabelText("commentLabel")).toBeNull();
  });

  it("restores a rejected reopen drag that was confirmed with a comment", async () => {
    const user = userEvent.setup();
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    renderBoard([CANCELED_TASK]);

    await dropOnTodo("task-1", "done");
    // The reopen branch owns its own rollback and clears the dialog state
    // before reporting, so it is proven separately from the plain drop.
    await user.type(
      await screen.findByLabelText("commentLabel"),
      "Reopening for the release",
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Errors.updateStatus"),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-column", "done");
    expect(boardCard("task-1")).toHaveAttribute(
      "data-status",
      TaskStatus.CANCELED,
    );
    expect(showCalendarClientUpgradeModalMock).not.toHaveBeenCalled();
  });
});

describe("TasksView board drag time in status", () => {
  const OLD = "2026-06-01T08:00:00.000Z";
  const NOW = new Date("2026-06-09T10:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the clock when a moved Task takes its new status", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: true,
    } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
    renderBoard([{ ...TASK, statusSince: OLD }]);

    await dropOnTodo("task-1", "backlog");

    await waitFor(() =>
      expect(boardCard("task-1")).toHaveAttribute("data-column", "todo"),
    );
    expect(boardCard("task-1")).toHaveAttribute(
      "data-status-since",
      NOW.toISOString(),
    );
  });

  it("restores the old time in status when the move is rejected", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    renderBoard([{ ...TASK, statusSince: OLD }]);

    await dropOnTodo("task-1", "backlog");

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(boardCard("task-1")).toHaveAttribute("data-column", "backlog");
    expect(boardCard("task-1")).toHaveAttribute("data-status-since", OLD);
  });

  it("restores the old time in status when a reopen is cancelled", async () => {
    renderBoard([{ ...CANCELED_TASK, statusSince: OLD }]);

    await dropOnTodo("task-1", "done");
    await screen.findByLabelText("commentLabel");
    expect(boardCard("task-1")).toHaveAttribute(
      "data-status-since",
      NOW.toISOString(),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    await waitFor(() =>
      expect(boardCard("task-1")).toHaveAttribute("data-column", "done"),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-status-since", OLD);
    expect(setTaskStatusFromDrag).not.toHaveBeenCalled();
  });
});

describe("TasksView without the task-board guide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it.each([null, "false", "true"])(
    "keeps an empty board usable when old guide storage is %s",
    async (storedValue) => {
      const key = "sokosumi.tasks.guideCompleted";
      if (storedValue !== null) window.localStorage.setItem(key, storedValue);
      const user = userEvent.setup();
      const { container, unmount } = renderBoard([]);

      expect(
        screen.queryByRole("button", { name: "Show guide" }),
      ).not.toBeInTheDocument();
      expect(
        container.querySelector(
          "[data-tasks-empty-state-overlay], [data-tasks-empty-state-overlay-mobile]",
        ),
      ).toBeNull();
      // The Calendar is a page of its own, not a tab here.
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Filters" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "createTaskFab" }));
      expect(openCreateTaskMock).toHaveBeenCalledOnce();
      expect(window.localStorage.getItem(key)).toBe(storedValue);
      unmount();
    },
  );
});

it("keeps board and list drag overlays in Compact", async () => {
  const user = userEvent.setup();
  renderBoard([TASK], "compact");
  const onDragStart = dndContextPropsSpy.mock.calls.at(-1)?.[0]
    ?.onDragStart as (event: DragStartEvent) => void;
  act(() =>
    onDragStart({
      activatorEvent: new Event("pointerdown"),
      active: {
        id: TASK.id,
        data: { current: { columnId: TASK.columnId } },
        rect: { current: { initial: new DOMRect(), translated: null } },
      },
    }),
  );
  expect(screen.getByTestId("board-overlay")).toHaveAttribute(
    "data-compact",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("radio", { name: "List" }));
  expect(screen.getByTestId("list-overlay")).toHaveAttribute(
    "data-compact",
    "true",
  );
});

it("hands a link's ?view=board back to the saved view when List is picked", async () => {
  searchParamsRef.current = new URLSearchParams("view=board&scope=owned");
  const user = userEvent.setup();
  renderBoard();
  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("radio", { name: "List" }));
  expect(document.cookie).toContain("tasks_view_mode=list");
  expect(replaceMock).toHaveBeenCalledWith("/tasks?scope=owned");
  expect(refreshMock).not.toHaveBeenCalled();
  searchParamsRef.current = new URLSearchParams();
});

it("turns on Show sub-tasks without reloading the page", async () => {
  replaceMock.mockClear();
  const replaceState = vi.spyOn(window.history, "replaceState");
  try {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getByRole("button", { name: "Display" }));
    await user.click(screen.getByRole("switch", { name: "Show subtasks" }));

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("subtasks=1"),
    );
    expect(replaceMock).not.toHaveBeenCalled();
  } finally {
    replaceState.mockRestore();
  }
});

it("keeps a task that left the server page when this tab did not archive it", () => {
  const shifted: TaskWithCoworker = { ...TASK, id: "task-shifted" };
  const { rerender } = renderBoard([TASK, shifted]);
  expect(boardCard(shifted.id)).toBeInTheDocument();

  rerender(boardView([TASK]));

  expect(boardCard(shifted.id)).toBeInTheDocument();
});

it("drops a task this tab archived, including when the refresh still returns it", () => {
  const archived: TaskWithCoworker = { ...TASK, id: "task-archived" };
  const { rerender } = renderBoard([TASK, archived]);
  expect(boardCard(archived.id)).toBeInTheDocument();

  markTaskArchived(archived.id);
  rerender(boardView([TASK, archived]));

  expect(
    screen.queryByTestId(`board-card-${archived.id}`),
  ).not.toBeInTheDocument();
  expect(boardCard(TASK.id)).toBeInTheDocument();
});

it("drops a load-more task once it is archived, and keeps the other load-more rows", async () => {
  const loaded: TaskWithCoworker = { ...CANCELED_TASK, id: "task-loaded" };
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-loaded-archived",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValue({
    tasks: [loaded, archived],
    nextCursor: null,
  });
  const { rerender } = render(boardView([TASK], undefined, "cursor-1"));
  // userEvent never reaches this footer button here; a native click does.
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();

  markTaskArchived(archived.id);
  rerender(boardView([TASK], undefined, "cursor-1"));

  expect(
    screen.queryByTestId(`board-card-${archived.id}`),
  ).not.toBeInTheDocument();
  expect(boardCard(loaded.id)).toBeInTheDocument();
});

it("discards a slow page for the previous tag after the board switches tags", async () => {
  const page =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksColumn>>>();
  vi.mocked(loadMoreTasksColumn).mockReturnValueOnce(page.promise);
  const taggedBoard = (tag: string) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView([TASK], undefined, "done-cursor"), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };
  try {
    const { rerender } = render(taggedBoard("research"));
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(loadMoreTasksColumn).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "research" }),
    );
    rerender(taggedBoard("writing"));
    // Even a return to the original tag starts a fresh stream of pages.
    rerender(taggedBoard("research"));
    await act(async () => {
      page.resolve({
        tasks: [{ ...CANCELED_TASK, id: "old-research" }],
        nextCursor: null,
      });
      await page.promise;
    });
    expect(
      screen.queryByTestId("board-card-old-research"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("keeps the new list cursor when a filter changes during a pending Load more", async () => {
  const stalePage =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksList>>>();
  const nextPage =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksList>>>();
  vi.mocked(loadMoreTasksList)
    .mockReturnValueOnce(stalePage.promise)
    .mockReturnValueOnce(nextPage.promise);

  const taggedList = (tag: string, listNextCursor: string | null) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView([TASK]), {
      defaultViewMode: "list" as const,
      listNextCursor,
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };

  try {
    const { rerender } = render(taggedList("research", "research-cursor-1"));
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(loadMoreTasksList).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "research-cursor-1",
        tag: "research",
      }),
    );

    rerender(taggedList("writing", "writing-cursor-1"));

    await act(async () => {
      stalePage.resolve({
        tasks: [{ ...CANCELED_TASK, id: "old-research-list" }],
        nextCursor: null,
      });
      await stalePage.promise;
    });

    expect(
      screen.queryByTestId("list-row-old-research-list"),
    ).not.toBeInTheDocument();

    const loadMore = screen.getByRole("button", { name: "Load more" });
    expect(loadMore).toBeEnabled();
    act(() => loadMore.click());
    expect(loadMoreTasksList).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: "writing-cursor-1",
        tag: "writing",
      }),
    );

    await act(async () => {
      nextPage.resolve({ tasks: [], nextCursor: null });
      await nextPage.promise;
    });
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("keeps the column's unloaded count in step as more Tasks load", async () => {
  const doneHidden = () =>
    screen.getByTestId("board-density").getAttribute("data-done-hidden");
  vi.mocked(loadMoreTasksColumn).mockResolvedValue({
    tasks: [
      { ...CANCELED_TASK, id: "done-1" },
      { ...CANCELED_TASK, id: "done-2" },
    ],
    nextCursor: "cursor-2",
  });
  render(boardView([TASK], undefined, "cursor-1", 24));
  expect(doneHidden()).toBe("24");

  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(await screen.findByTestId("board-card-done-2")).toBeInTheDocument();
  // Two came in, so two fewer wait: the header still adds up to the column.
  expect(doneHidden()).toBe("22");
});

describe("TasksView filtered empty state", () => {
  const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

  afterEach(() => {
    searchParamsRef.current = new URLSearchParams();
  });

  function emptyView(filters: TasksFilters) {
    return (
      <TasksView
        tasks={[]}
        listNextCursor={null}
        columnHiddenCountById={{
          backlog: 0,
          todo: 0,
          "in-progress": 0,
          "input-required": 0,
          done: 0,
        }}
        columnNextCursorById={{
          backlog: null,
          todo: null,
          "in-progress": null,
          "input-required": null,
          done: null,
        }}
        coworkerOptions={[]}
        projectOptions={[{ id: PROJECT_ID, name: "Research" }]}
        userId={null}
        activeOrganizationId={null}
        initialFilters={filters}
        defaultViewMode="board"
        canCreateTask
        labels={labels}
      />
    );
  }

  it("says a filter hides every task and clears it, keeping the project", async () => {
    searchParamsRef.current = new URLSearchParams(
      `status=COMPLETED&projectId=${PROJECT_ID}`,
    );
    render(
      emptyView({
        ...EMPTY_FILTERS,
        status: TaskStatus.COMPLETED,
        projectId: PROJECT_ID,
      }),
    );

    expect(screen.getByText("Filters.noMatchesTitle")).toBeInTheDocument();
    expect(screen.queryByTestId("board-density")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Filters.clear" }),
    );
    expect(replaceMock).toHaveBeenCalledWith(
      `/tasks?projectId=${PROJECT_ID}&scope=owned`,
    );
  });

  it("names the search when only a search hides every task", async () => {
    searchParamsRef.current = new URLSearchParams("q=zebra");
    const onUrlUpdate = vi.fn();
    render(emptyView({ ...EMPTY_FILTERS, search: "zebra" }), {
      // The search field's text lives in nuqs `q`: Clear search writes it there.
      wrapper: ({ children }) => (
        <NuqsTestingAdapter searchParams="?q=zebra" onUrlUpdate={onUrlUpdate}>
          {children}
        </NuqsTestingAdapter>
      ),
    });

    expect(
      screen.getByText("Filters.noSearchMatchesTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Filters.noSearchMatchesDescription"),
    ).toBeInTheDocument();

    focusedFilters = false;
    await userEvent.click(
      screen.getByRole("button", { name: "Filters.clearSearch" }),
    );
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ queryString: "" }),
      ),
    );
    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toHaveFocus();
    // Only the search field takes focus: no stop on Filters on the way.
    expect(focusedFilters).toBe(false);
  });

  it("keeps the plain board when nothing is filtered", () => {
    render(emptyView(EMPTY_FILTERS));

    expect(screen.getByTestId("board-density")).toBeInTheDocument();
    expect(
      screen.queryByText("Filters.noMatchesTitle"),
    ).not.toBeInTheDocument();
  });
});

it("discards a delayed page that settles after a hidden board switches filters under Activity", async () => {
  const PROJECT_A = "11111111-1111-4111-8111-111111111111";
  const PROJECT_B = "22222222-2222-4222-8222-222222222222";
  const page =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksColumn>>>();
  vi.mocked(loadMoreTasksColumn).mockReturnValueOnce(page.promise);
  const projectBTask: TaskWithCoworker = { ...TASK, id: "task-project-b" };
  const projectBoard = (
    projectId: string,
    tasks: TaskWithCoworker[],
    doneCursor: string | null,
  ) => {
    searchParamsRef.current = new URLSearchParams({ projectId });
    return cloneElement(boardView(tasks, undefined, doneCursor), {
      projectOptions: [
        { id: PROJECT_A, name: "Alpha" },
        { id: PROJECT_B, name: "Beta" },
      ],
      initialFilters: { ...EMPTY_FILTERS, projectId },
    });
  };
  try {
    const { rerender } = render(
      <Activity mode="visible">
        {projectBoard(PROJECT_A, [TASK], "alpha-cursor-1")}
      </Activity>,
    );
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(loadMoreTasksColumn).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        {projectBoard(PROJECT_B, [projectBTask], "beta-cursor-1")}
      </Activity>,
    );

    await act(async () => {
      page.resolve({
        tasks: [{ ...CANCELED_TASK, id: "stale-alpha-page" }],
        nextCursor: null,
      });
      await page.promise;
    });

    rerender(
      <Activity mode="visible">
        {projectBoard(PROJECT_A, [TASK], "alpha-cursor-1")}
      </Activity>,
    );

    expect(
      screen.queryByTestId("board-card-stale-alpha-page"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("does not roll back or toast a rejected drag after a hidden board switches filters under Activity", async () => {
  vi.mocked(toast.error).mockClear();
  const dragResult =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag).mockReturnValueOnce(dragResult.promise);
  const updatedTask: TaskWithCoworker = {
    ...TASK,
    status: TaskStatus.READY,
    columnId: "todo",
  };
  const taggedBoard = (tag: string, tasks: TaskWithCoworker[]) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView(tasks), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };
  try {
    const { rerender } = render(
      <Activity mode="visible">{taggedBoard("research", [TASK])}</Activity>,
    );
    await dropOnTodo(TASK.id, "backlog");
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    rerender(
      <Activity mode="hidden">
        {taggedBoard("writing", [updatedTask])}
      </Activity>,
    );

    await act(async () => {
      dragResult.resolve({
        ok: false,
        error: { kind: "status_not_selectable" },
      });
      await dragResult.promise;
    });

    rerender(
      <Activity mode="visible">
        {taggedBoard("writing", [updatedTask])}
      </Activity>,
    );

    expect(toast.error).not.toHaveBeenCalled();
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("does not toast or clear the new cursor when a column page rejects after a visible filter change", async () => {
  vi.mocked(toast.error).mockClear();
  const stalePage =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksColumn>>>();
  const nextPage =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksColumn>>>();
  vi.mocked(loadMoreTasksColumn)
    .mockReturnValueOnce(stalePage.promise)
    .mockReturnValueOnce(nextPage.promise);

  const taggedBoard = (tag: string, doneCursor: string | null) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView([TASK], undefined, doneCursor), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };

  try {
    const { rerender } = render(taggedBoard("research", "research-cursor-1"));
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(loadMoreTasksColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "research-cursor-1",
        tag: "research",
      }),
    );

    rerender(taggedBoard("writing", "writing-cursor-1"));

    await act(async () => {
      stalePage.reject(new Error("network"));
      await stalePage.promise.catch(() => undefined);
    });

    expect(toast.error).not.toHaveBeenCalled();
    const loadMore = screen.getByRole("button", { name: "Load more" });
    expect(loadMore).toBeEnabled();
    act(() => loadMore.click());
    expect(loadMoreTasksColumn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: "writing-cursor-1",
        tag: "writing",
      }),
    );

    await act(async () => {
      nextPage.resolve({ tasks: [], nextCursor: null });
      await nextPage.promise;
    });
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("does not toast a rejected drag after a visible filter change", async () => {
  vi.mocked(toast.error).mockClear();
  const dragResult =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag).mockReturnValueOnce(dragResult.promise);

  const taggedBoard = (tag: string, tasks: TaskWithCoworker[]) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView(tasks), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };

  try {
    const { rerender } = render(taggedBoard("research", [TASK]));
    await dropOnTodo(TASK.id, "backlog");
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    rerender(taggedBoard("writing", [TASK]));

    await act(async () => {
      dragResult.resolve({
        ok: false,
        error: { kind: "status_not_selectable" },
      });
      await dragResult.promise;
    });

    expect(toast.error).not.toHaveBeenCalled();
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("does not roll back a newer drag on the new filter when an earlier drag rejects", async () => {
  vi.mocked(toast.error).mockClear();
  const firstDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  const secondDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag)
    .mockReturnValueOnce(firstDrag.promise)
    .mockReturnValueOnce(secondDrag.promise);

  const taggedBoard = (tag: string, tasks: TaskWithCoworker[]) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView(tasks), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };

  try {
    const { rerender } = render(taggedBoard("research", [TASK]));
    await dropOnTodo(TASK.id, "backlog");
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    // Server still shows the task in Backlog under the new filter.
    rerender(taggedBoard("writing", [TASK]));
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "backlog");

    // Drag the task to To do again under the new filter.
    await dropOnTodo(TASK.id, "backlog");
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    // The first drag from `research` rejects while the second drag is pending.
    await act(async () => {
      firstDrag.resolve({
        ok: false,
        error: { kind: "status_not_selectable" },
      });
      await firstDrag.promise;
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    // The second drag succeeds and the card stays in To do.
    await act(async () => {
      secondDrag.resolve({
        ok: true,
      } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
      await secondDrag.promise;
    });

    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("settles a rejected Load more on filter A when a transition to filter B suspends", async () => {
  vi.mocked(toast.error).mockClear();
  const page =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksColumn>>>();
  vi.mocked(loadMoreTasksColumn).mockReturnValueOnce(page.promise);
  const suspendedGate = Promise.withResolvers<void>();

  function SuspendGate({ promise }: { promise: Promise<void> | null }) {
    if (promise) {
      use(promise);
    }
    return null;
  }

  let triggerSuspendedSwitch: (() => void) | null = null;
  function Harness() {
    const [tag, setTag] = useState("research");
    const [pendingGate, setPendingGate] = useState<Promise<void> | null>(null);
    triggerSuspendedSwitch = () => {
      searchParamsRef.current = new URLSearchParams({ tag: "writing" });
      startTransition(() => {
        setTag("writing");
        setPendingGate(suspendedGate.promise);
      });
    };
    const doneCursor =
      tag === "research" ? "research-cursor-1" : "writing-cursor-1";
    return (
      <Suspense fallback={<div>loading</div>}>
        {cloneElement(boardView([TASK], undefined, doneCursor), {
          initialFilters: { ...EMPTY_FILTERS, tag },
        })}
        <SuspendGate promise={pendingGate} />
      </Suspense>
    );
  }

  try {
    searchParamsRef.current = new URLSearchParams({ tag: "research" });
    render(<Harness />);

    const loadMore = screen.getByRole("button", { name: "Load more" });
    act(() => loadMore.click());
    expect(loadMore).toHaveAttribute("aria-busy", "true");

    // Start switching to filter B; TasksView renders B, then SuspendGate suspends
    // so filter A remains committed and visible on screen.
    await act(async () => {
      triggerSuspendedSwitch?.();
    });
    expect(screen.getByRole("button", { name: "Load more" })).toBeVisible();

    await act(async () => {
      page.reject(new Error("network"));
      await page.promise.catch(() => undefined);
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not load more"),
    );
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    // Once filter B finishes suspending, filter B commits with its own cursor.
    await act(async () => {
      suspendedGate.resolve();
      await suspendedGate.promise;
    });
    const writingLoadMore = screen.getByRole("button", { name: "Load more" });
    expect(writingLoadMore).toBeEnabled();
    expect(writingLoadMore).not.toHaveAttribute("aria-busy", "true");
  } finally {
    await act(async () => {
      suspendedGate.resolve();
      await suspendedGate.promise;
    });
    searchParamsRef.current = new URLSearchParams();
  }
});

it("rolls back both tasks when two drags reject in one batch on the same board", async () => {
  vi.mocked(toast.error).mockClear();
  const secondTask: TaskWithCoworker = { ...TASK, id: "task-2" };
  const firstDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  const secondDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag)
    .mockReturnValueOnce(firstDrag.promise)
    .mockReturnValueOnce(secondDrag.promise);

  renderBoard([TASK, secondTask]);

  await dropOnTodo(TASK.id, "backlog");
  await dropOnTodo(secondTask.id, "backlog");
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");
  expect(boardCard(secondTask.id)).toHaveAttribute("data-column", "todo");

  await act(async () => {
    firstDrag.resolve({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    secondDrag.resolve({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    await Promise.all([firstDrag.promise, secondDrag.promise]);
  });

  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "backlog");
  expect(boardCard(secondTask.id)).toHaveAttribute("data-column", "backlog");
  expect(toast.error).toHaveBeenCalledTimes(2);
});

it("ignores two rejected drags from the previous filter settled in one batch after a filter change", async () => {
  vi.mocked(toast.error).mockClear();
  const secondTask: TaskWithCoworker = { ...TASK, id: "task-2" };
  const oldDrag1 =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  const oldDrag2 =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  const newDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag)
    .mockReturnValueOnce(oldDrag1.promise)
    .mockReturnValueOnce(oldDrag2.promise)
    .mockReturnValueOnce(newDrag.promise);

  const taggedBoard = (tag: string, tasks: TaskWithCoworker[]) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView(tasks), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };

  try {
    const { rerender } = render(taggedBoard("research", [TASK, secondTask]));
    await dropOnTodo(TASK.id, "backlog");
    await dropOnTodo(secondTask.id, "backlog");

    rerender(taggedBoard("writing", [TASK, secondTask]));
    await dropOnTodo(TASK.id, "backlog");
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    await act(async () => {
      oldDrag1.resolve({
        ok: false,
        error: { kind: "status_not_selectable" },
      });
      oldDrag2.resolve({
        ok: false,
        error: { kind: "status_not_selectable" },
      });
      await Promise.all([oldDrag1.promise, oldDrag2.promise]);
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

    await act(async () => {
      newDrag.resolve({
        ok: true,
      } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
      await newDrag.promise;
    });
    expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("keeps a confirmed move when switching from Board to List", async () => {
  vi.mocked(setTaskStatusFromDrag).mockResolvedValueOnce({
    ok: true,
  } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
  const user = userEvent.setup();
  renderBoard([TASK]);

  await dropOnTodo(TASK.id, "backlog");
  expect(boardCard(TASK.id)).toHaveAttribute("data-status", TaskStatus.READY);

  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("radio", { name: "List" }));

  expect(screen.getByTestId(`list-row-${TASK.id}`)).toHaveAttribute(
    "data-status",
    TaskStatus.READY,
  );
});

it("rolls back a rejected drag without a toast while hidden under Activity on the same filter", async () => {
  vi.mocked(toast.error).mockClear();
  const dragResult =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag).mockReturnValueOnce(dragResult.promise);

  const view = boardView([TASK]);
  const { rerender } = render(<Activity mode="visible">{view}</Activity>);

  await dropOnTodo(TASK.id, "backlog");
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

  rerender(<Activity mode="hidden">{view}</Activity>);

  await act(async () => {
    dragResult.resolve({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    await dragResult.promise;
  });

  rerender(<Activity mode="visible">{view}</Activity>);

  expect(toast.error).not.toHaveBeenCalled();
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "backlog");
});

it("does not roll back a newer drag after a Board-List-Board view switch when an earlier drag rejects", async () => {
  vi.mocked(toast.error).mockClear();
  const firstDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  const secondDrag =
    Promise.withResolvers<Awaited<ReturnType<typeof setTaskStatusFromDrag>>>();
  vi.mocked(setTaskStatusFromDrag)
    .mockReturnValueOnce(firstDrag.promise)
    .mockReturnValueOnce(secondDrag.promise);

  const { rerender } = render(
    cloneElement(boardView([TASK]), { defaultViewMode: "board" as const }),
  );
  await dropOnTodo(TASK.id, "backlog");
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

  rerender(
    cloneElement(boardView([TASK]), { defaultViewMode: "list" as const }),
  );
  rerender(
    cloneElement(boardView([TASK]), { defaultViewMode: "board" as const }),
  );
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "backlog");

  await dropOnTodo(TASK.id, "backlog");
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

  await act(async () => {
    firstDrag.resolve({
      ok: false,
      error: { kind: "status_not_selectable" },
    });
    await firstDrag.promise;
  });

  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");

  await act(async () => {
    secondDrag.resolve({
      ok: true,
    } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
    await secondDrag.promise;
  });
  expect(boardCard(TASK.id)).toHaveAttribute("data-column", "todo");
});

it("keeps the toolbar mounted while remounting the board when the server filter changes", () => {
  const taggedBoard = (tag: string) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView([TASK]), {
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };
  try {
    const { rerender } = render(taggedBoard("research"));
    const filtersButton = screen.getByRole("button", { name: "Filters" });
    const boardNode = screen.getByTestId("board-density");

    rerender(taggedBoard("writing"));

    expect(screen.getByRole("button", { name: "Filters" })).toBe(filtersButton);
    expect(screen.getByTestId("board-density")).not.toBe(boardNode);
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("keeps column Load more tasks that settle while hidden under Activity on the same filter", async () => {
  const loaded: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-loaded-while-hidden",
  };
  const page =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksColumn>>>();
  vi.mocked(loadMoreTasksColumn).mockReturnValueOnce(page.promise);

  const view = boardView([TASK], undefined, "cursor-1", 1);
  const { rerender } = render(<Activity mode="visible">{view}</Activity>);

  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(loadMoreTasksColumn).toHaveBeenCalledTimes(1);

  rerender(<Activity mode="hidden">{view}</Activity>);

  await act(async () => {
    page.resolve({ tasks: [loaded], nextCursor: null });
    await page.promise;
  });

  rerender(<Activity mode="visible">{view}</Activity>);

  expect(boardCard(loaded.id)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("does not toast or clear the new list cursor when a list page rejects after a visible filter change", async () => {
  vi.mocked(toast.error).mockClear();
  const stalePage =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksList>>>();
  const nextPage =
    Promise.withResolvers<Awaited<ReturnType<typeof loadMoreTasksList>>>();
  vi.mocked(loadMoreTasksList)
    .mockReturnValueOnce(stalePage.promise)
    .mockReturnValueOnce(nextPage.promise);

  const taggedList = (tag: string, listNextCursor: string | null) => {
    searchParamsRef.current = new URLSearchParams({ tag });
    return cloneElement(boardView([TASK]), {
      defaultViewMode: "list" as const,
      listNextCursor,
      initialFilters: { ...EMPTY_FILTERS, tag },
    });
  };

  try {
    const { rerender } = render(taggedList("research", "research-cursor-1"));
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(loadMoreTasksList).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "research-cursor-1",
        tag: "research",
      }),
    );

    rerender(taggedList("writing", "writing-cursor-1"));

    await act(async () => {
      stalePage.reject(new Error("network"));
      await stalePage.promise.catch(() => undefined);
    });

    expect(toast.error).not.toHaveBeenCalled();
    const loadMore = screen.getByRole("button", { name: "Load more" });
    expect(loadMore).toBeEnabled();
    act(() => loadMore.click());
    expect(loadMoreTasksList).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: "writing-cursor-1",
        tag: "writing",
      }),
    );

    await act(async () => {
      nextPage.resolve({ tasks: [], nextCursor: null });
      await nextPage.promise;
    });
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("does not remount the board or lose loaded pages when createTaskModalResetKey changes", async () => {
  const loaded: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-loaded-before-modal-reset",
  };
  vi.mocked(loadMoreTasksColumn)
    .mockResolvedValueOnce({ tasks: [loaded], nextCursor: "cursor-2" })
    .mockResolvedValueOnce({ tasks: [], nextCursor: null });

  const { rerender } = render(
    cloneElement(boardView([TASK], undefined, "cursor-1", 2), {
      initialCreateTaskOpen: true,
      createTaskModalResetKey: "true---",
    }),
  );
  const boardNode = screen.getByTestId("board-density");

  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${loaded.id}`),
  ).toBeInTheDocument();

  // Dismissing /tasks?create=true changes createTaskModalResetKey while filters stay identical.
  rerender(
    cloneElement(boardView([TASK], undefined, "cursor-1", 2), {
      initialCreateTaskOpen: false,
      createTaskModalResetKey: "false---",
    }),
  );

  expect(screen.getByTestId("board-density")).toBe(boardNode);
  expect(boardCard(loaded.id)).toBeInTheDocument();

  act(() => screen.getByRole("button", { name: "Load more" }).click());
  await waitFor(() =>
    expect(loadMoreTasksColumn).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-2" }),
    ),
  );
});

it("does not rewind the column cursor when archiving the only loaded task", async () => {
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-only-loaded-archived",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValue({
    tasks: [archived],
    nextCursor: null,
  });

  const { rerender } = render(boardView([TASK], undefined, "cursor-1", 1));
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  markTaskArchived(archived.id);
  rerender(boardView([TASK], undefined, "cursor-1", 1));

  expect(
    screen.queryByTestId(`board-card-${archived.id}`),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");
});

it("does not rewind the column cursor when archiving the only loaded task on a tagged board", async () => {
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-tagged-only-loaded-archived",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValue({
    tasks: [archived],
    nextCursor: null,
  });

  const taggedBoard = (
    tasks: TaskWithCoworker[],
    doneCursor: string | null,
    doneHidden: number,
  ) => {
    searchParamsRef.current = new URLSearchParams({ tag: "research" });
    return cloneElement(boardView(tasks, undefined, doneCursor, doneHidden), {
      initialFilters: { ...EMPTY_FILTERS, tag: "research" },
    });
  };

  try {
    const { rerender } = render(taggedBoard([TASK], "cursor-1", 1));
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(
      await screen.findByTestId(`board-card-${archived.id}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    markTaskArchived(archived.id);
    rerender(taggedBoard([TASK], "cursor-1", 1));

    expect(
      screen.queryByTestId(`board-card-${archived.id}`),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(
      screen.getByTestId("board-density").getAttribute("data-done-hidden"),
    ).toBe("0");
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("resyncs the column cursor on an ordinary refresh after loading a page", async () => {
  const loaded: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-loaded-ordinary-refresh",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValue({
    tasks: [loaded],
    nextCursor: null,
  });

  const { rerender } = render(boardView([TASK], undefined, "cursor-1", 1));
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${loaded.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  // Ordinary server refresh now includes the loaded task on page 1 and reports
  // newer rows waiting behind a fresh cursor.
  rerender(boardView([TASK, loaded], undefined, "cursor-2", 3));

  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("3");
});

it("keeps archive cursor preservation idempotent on Activity reveal under StrictMode", async () => {
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-strict-activity-archived",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValue({
    tasks: [archived],
    nextCursor: null,
  });

  const view = boardView([TASK], undefined, "cursor-1", 1);
  const { rerender } = render(
    <StrictMode>
      <Activity mode="visible">{view}</Activity>
    </StrictMode>,
  );

  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  rerender(
    <StrictMode>
      <Activity mode="hidden">{view}</Activity>
    </StrictMode>,
  );
  markTaskArchived(archived.id);
  rerender(
    <StrictMode>
      <Activity mode="visible">{view}</Activity>
    </StrictMode>,
  );

  expect(
    screen.queryByTestId(`board-card-${archived.id}`),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");
});

it("preserves only the archived column's cursor when another column gains an overflow cursor", async () => {
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-done-archived-concurrent-todo",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [archived],
    nextCursor: null,
  });

  const withTodoAndDone = (
    doneCursor: string | null,
    doneHidden: number,
    todoCursor: string | null,
    todoHidden: number,
  ) =>
    cloneElement(boardView([TASK], undefined, doneCursor, doneHidden), {
      columnNextCursorById: {
        backlog: null,
        todo: todoCursor,
        "in-progress": null,
        "input-required": null,
        done: doneCursor,
      },
      columnHiddenCountById: {
        backlog: 0,
        todo: todoHidden,
        "in-progress": 0,
        "input-required": 0,
        done: doneHidden,
      },
    });

  const { rerender } = render(withTodoAndDone("done-cursor-1", 1, null, 0));
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  // Archive the loaded Done task while a concurrent change adds overflow to To do.
  markTaskArchived(archived.id);
  rerender(withTodoAndDone("done-cursor-1", 1, "todo-cursor-1", 1));

  expect(
    screen.queryByTestId(`board-card-${archived.id}`),
  ).not.toBeInTheDocument();
  // Done stays exhausted; To do receives its new cursor and hidden count.
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");
  expect(
    screen.getByTestId("board-density").getAttribute("data-todo-hidden"),
  ).toBe("1");

  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [],
    nextCursor: null,
  });
  await act(async () => {
    screen.getByRole("button", { name: "Load more" }).click();
    await Promise.resolve();
  });
  expect(loadMoreTasksColumn).toHaveBeenLastCalledWith(
    expect.objectContaining({
      columnId: "todo",
      cursor: "todo-cursor-1",
    }),
  );
});

it("restores Load more after a failed page when returning via cached Activity reveal", async () => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(loadMoreTasksColumn).mockRejectedValueOnce(new Error("network"));

  const view = boardView([TASK], undefined, "cursor-1", 1);
  const { rerender } = render(<Activity mode="visible">{view}</Activity>);

  await act(async () => {
    screen.getByRole("button", { name: "Load more" }).click();
    await Promise.resolve();
  });
  expect(toast.error).toHaveBeenCalledWith("Could not load more");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  rerender(<Activity mode="hidden">{view}</Activity>);
  rerender(<Activity mode="visible">{view}</Activity>);

  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
});

it("resyncs the column cursor on a tagged board when archiving one of two loaded rows drops the other", async () => {
  const loaded: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-tagged-loaded-sibling",
  };
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-tagged-archived-sibling",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [loaded, archived],
    nextCursor: null,
  });

  const taggedBoard = (
    tasks: TaskWithCoworker[],
    doneCursor: string | null,
    doneHidden: number,
  ) => {
    searchParamsRef.current = new URLSearchParams({ tag: "research" });
    return cloneElement(boardView(tasks, undefined, doneCursor, doneHidden), {
      initialFilters: { ...EMPTY_FILTERS, tag: "research" },
    });
  };

  try {
    const { rerender } = render(taggedBoard([TASK], "cursor-1", 2));
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(
      await screen.findByTestId(`board-card-${archived.id}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    // Archive one loaded row; keepLocalOnlyTasks=false drops the sibling because
    // archive membership cannot tell whether the sibling still holds the tag,
    // so Done must resync its cursor instead of stranding the sibling.
    markTaskArchived(archived.id);
    rerender(taggedBoard([TASK], "cursor-1", 1));

    expect(
      screen.queryByTestId(`board-card-${archived.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`board-card-${loaded.id}`),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
    expect(
      screen.getByTestId("board-density").getAttribute("data-done-hidden"),
    ).toBe("1");
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("keeps the archived column's remaining loaded row and cursor while another column gains overflow", async () => {
  const loaded: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-done-loaded-sibling-concurrent-todo",
  };
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-done-archived-sibling-concurrent-todo",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [loaded, archived],
    nextCursor: null,
  });

  const withTodoAndDone = (
    doneCursor: string | null,
    doneHidden: number,
    todoCursor: string | null,
    todoHidden: number,
  ) =>
    cloneElement(boardView([TASK], undefined, doneCursor, doneHidden), {
      columnNextCursorById: {
        backlog: null,
        todo: todoCursor,
        "in-progress": null,
        "input-required": null,
        done: doneCursor,
      },
      columnHiddenCountById: {
        backlog: 0,
        todo: todoHidden,
        "in-progress": 0,
        "input-required": 0,
        done: doneHidden,
      },
    });

  const { rerender } = render(withTodoAndDone("done-cursor-1", 2, null, 0));
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  markTaskArchived(archived.id);
  rerender(withTodoAndDone("done-cursor-1", 1, "todo-cursor-1", 1));

  expect(
    screen.queryByTestId(`board-card-${archived.id}`),
  ).not.toBeInTheDocument();
  expect(boardCard(loaded.id)).toBeInTheDocument();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");
  expect(
    screen.getByTestId("board-density").getAttribute("data-todo-hidden"),
  ).toBe("1");
  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
});

it("does not freeze a column's cursor when archiving a page-1 task", () => {
  const pageOneDone: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-page-one-archived",
  };
  const promotedDone: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-promoted-after-archive",
  };

  const { rerender } = render(
    boardView([TASK, pageOneDone], undefined, "cursor-1", 5),
  );
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("5");

  markTaskArchived(pageOneDone.id);
  rerender(boardView([TASK, promotedDone], undefined, "cursor-2", 4));

  expect(
    screen.queryByTestId(`board-card-${pageOneDone.id}`),
  ).not.toBeInTheDocument();
  expect(boardCard(promotedDone.id)).toBeInTheDocument();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("4");
});

it("restores Load more on cached Activity reveal if a background archive fails", async () => {
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-failed-archive-restore-cursor",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [archived],
    nextCursor: null,
  });

  const view = boardView([TASK], undefined, "cursor-1", 1);
  const { rerender } = render(<Activity mode="visible">{view}</Activity>);

  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  rerender(<Activity mode="hidden">{view}</Activity>);
  markTaskArchived(archived.id);
  rerender(<Activity mode="visible">{view}</Activity>);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  rerender(<Activity mode="hidden">{view}</Activity>);
  unmarkTaskArchived(archived.id);
  rerender(<Activity mode="visible">{view}</Activity>);

  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("1");
});

it("keeps the archived column's cursor across a racing pre-delete server refresh, then resyncs on new server data", async () => {
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-racing-pre-delete-refresh",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [archived],
    nextCursor: null,
  });

  const { rerender } = render(boardView([TASK], undefined, "cursor-1", 1));
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  // Reveal / first refresh drops the archived task and preserves Done.
  markTaskArchived(archived.id);
  rerender(boardView([TASK], undefined, "cursor-1", 1));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");

  // Second refresh arrives with fresh prop objects before DELETE finishes on Core,
  // still reporting the same stale Done cursor and hidden count.
  rerender(boardView([TASK], undefined, "cursor-1", 1));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");

  // Once DELETE settles and a later refresh reports new Done pagination, Done resyncs.
  settleTaskArchive(archived.id);
  rerender(boardView([TASK], undefined, "cursor-2", 2));
  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("2");
});

it("restores Load more after DELETE settles when a new task fills the same page-2 spot", async () => {
  const pageOneDone: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-done-page-one-a",
  };
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-done-archived-a",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [archived],
    nextCursor: null,
  });

  const { rerender } = render(
    boardView([TASK, pageOneDone], undefined, "cursor-1", 1),
  );
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId(`board-card-${archived.id}`),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  // Pre-DELETE refresh keeps Done exhausted while DELETE is still in flight.
  markTaskArchived(archived.id);
  rerender(boardView([TASK, pageOneDone], undefined, "cursor-1", 1));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("0");

  // After DELETE settles, a new low-priority task fills the same page-2 spot
  // so first-page ids, cursor, and hidden count match the earlier values.
  settleTaskArchive(archived.id);
  rerender(boardView([TASK, pageOneDone], undefined, "cursor-1", 1));

  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("1");
});

it("resyncs Load more on a tagged board when the first post-DELETE refresh pushes a page-1 task to page 2", async () => {
  const pageOneDone: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-tagged-page-one-pushed-off",
  };
  const newerTaggedDone: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-tagged-newer-page-one",
  };
  const archived: TaskWithCoworker = {
    ...CANCELED_TASK,
    id: "task-tagged-loaded-archived-b",
  };
  vi.mocked(loadMoreTasksColumn).mockResolvedValueOnce({
    tasks: [archived],
    nextCursor: null,
  });

  const taggedBoard = (
    tasks: TaskWithCoworker[],
    doneCursor: string | null,
    doneHidden: number,
  ) => {
    searchParamsRef.current = new URLSearchParams({ tag: "research" });
    return cloneElement(boardView(tasks, undefined, doneCursor, doneHidden), {
      initialFilters: { ...EMPTY_FILTERS, tag: "research" },
    });
  };

  try {
    const { rerender } = render(
      taggedBoard([TASK, pageOneDone], "cursor-1", 1),
    );
    act(() => screen.getByRole("button", { name: "Load more" }).click());
    expect(
      await screen.findByTestId(`board-card-${archived.id}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    // Archive starts and settles before the first refresh arrives; meanwhile
    // a newer tagged task lands on page 1 and pushes old #20 to page 2.
    markTaskArchived(archived.id);
    settleTaskArchive(archived.id);
    rerender(taggedBoard([TASK, newerTaggedDone], "cursor-2", 1));

    expect(
      screen.queryByTestId(`board-card-${archived.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`board-card-${pageOneDone.id}`),
    ).not.toBeInTheDocument();
    expect(boardCard(newerTaggedDone.id)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
    expect(
      screen.getByTestId("board-density").getAttribute("data-done-hidden"),
    ).toBe("1");
  } finally {
    searchParamsRef.current = new URLSearchParams();
  }
});

it("refreshes Tasks when a pending archive settles while visible, and skips refreshing when hidden under Activity", () => {
  vi.useFakeTimers();
  refreshMock.mockClear();
  try {
    const view = boardView([TASK]);
    const { rerender } = render(<Activity mode="visible">{view}</Activity>);

    markTaskArchived("task-settle-while-visible");
    act(() => {
      settleTaskArchive("task-settle-while-visible");
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_DEBOUNCE_MS);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    refreshMock.mockClear();
    rerender(<Activity mode="hidden">{view}</Activity>);

    // User left /tasks (e.g. moved to /chat) before DELETE finished.
    markTaskArchived("task-settle-while-hidden");
    act(() => {
      settleTaskArchive("task-settle-while-hidden");
      vi.advanceTimersByTime(TASKS_BOARD_REFRESH_MAX_WAIT_MS);
    });
    expect(refreshMock).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("subtracts retained rows from the server hidden count when restoring Load more after a failed page", async () => {
  vi.mocked(toast.error).mockClear();
  const pageOneDone: TaskWithCoworker[] = Array.from(
    { length: 20 },
    (_, index) => ({
      ...CANCELED_TASK,
      id: `done-p1-${index + 1}`,
    }),
  );
  const pageTwoDone: TaskWithCoworker[] = Array.from(
    { length: 20 },
    (_, index) => ({
      ...CANCELED_TASK,
      id: `done-p2-${index + 1}`,
    }),
  );
  vi.mocked(loadMoreTasksColumn)
    .mockResolvedValueOnce({ tasks: pageTwoDone, nextCursor: "cursor-2" })
    .mockRejectedValueOnce(new Error("network"));

  // 41 Done tasks: 20 on page 1 + 21 hidden.
  const { rerender } = render(
    boardView(pageOneDone, undefined, "cursor-1", 21),
  );
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("21");

  // Load page 2: 40 shown + 1 hidden.
  act(() => screen.getByRole("button", { name: "Load more" }).click());
  expect(
    await screen.findByTestId("board-card-done-p2-20"),
  ).toBeInTheDocument();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("1");

  // Page 3 fails: Load more disappears while 40 rows remain shown.
  await act(async () => {
    screen.getByRole("button", { name: "Load more" }).click();
    await Promise.resolve();
  });
  expect(toast.error).toHaveBeenCalledWith("Could not load more");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  // Ordinary refresh returns page 1 (20 shown + 21 hidden behind page 1).
  // Restoring the server cursor must subtract the 20 retained page-2 rows so
  // the header reports 1 hidden (40 + 1 = 41), not 21 (40 + 21 = 61).
  rerender(boardView(pageOneDone, undefined, "cursor-1", 21));

  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  expect(boardCard("done-p2-20")).toBeInTheDocument();
  expect(
    screen.getByTestId("board-density").getAttribute("data-done-hidden"),
  ).toBe("1");
});
