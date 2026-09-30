import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { TaskStatus } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMoreTasksColumn } from "@/app/tasks/actions";
import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { markTaskArchived } from "@/app/tasks/utils/archived-task-ids";
import type { TasksFilters } from "@/app/tasks/utils/tasks-filters";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { parseTasksDensity } from "@/lib/ui-preferences/tasks-density";
import { TasksView } from "./tasks-view";

const {
  dndContextPropsSpy,
  openCreateTaskMock,
  pushMock,
  refreshMock,
  replaceMock,
  showCalendarClientUpgradeModalMock,
} = vi.hoisted(() => ({
  dndContextPropsSpy: vi.fn(),
  openCreateTaskMock: vi.fn(),
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
  }: {
    tasks: TaskWithCoworker[];
    compact: boolean;
    columnFooterById: Partial<Record<KanbanColumnId, ReactNode>>;
  }) => (
    <div data-testid="board-density" data-compact={compact}>
      {tasks.map((task) => (
        <div
          key={task.id}
          data-testid={`board-card-${task.id}`}
          data-column={task.columnId}
          data-status={task.status}
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
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("./tasks-view-filters", () => ({
  TasksViewFilters: () => <button type="button">Filters</button>,
}));
vi.mock("./task-list-view", () => ({
  TaskListView: ({ compact }: { compact: boolean }) => (
    <div data-testid="list-density" data-compact={compact} />
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
  tabs: { tasks: "Board", calendar: "Calendar" },
  filters: {
    title: "Filters",
    searchPlaceholder: "Search",
    emptyResults: "No results",
    all: "All",
    scopeLabel: "Scope",
    scopeOwned: "Owned",
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
    list: "List",
    board: "Board",
    density: "Density",
    normal: "Normal",
    compact: "Compact",
  },
  listPlaceholder: "No tasks",
  loadMore: "Load more",
  loading: "Loading",
  dragError: "Could not update the task",
  loadMoreError: "Could not load more",
  reopenToReady: {
    title: "Reopen task",
    description: "Say why",
    commentLabel: "Comment",
    commentPlaceholder: "Why reopen?",
    confirm: "Reopen",
    cancel: "Cancel",
    commentRequired: "A comment is required",
  },
} satisfies ComponentProps<typeof TasksView>["labels"];

const EMPTY_FILTERS: TasksFilters = {
  scope: "owned",
  assigneeId: null,
  assigneeSokoBotId: null,
  assigneeUserId: null,
  status: null,
  projectId: null,
  visibility: null,
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
) {
  return (
    <TasksView
      tasks={tasks}
      listNextCursor={null}
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

it("applies Display density to board and list and restores the saved preference", async () => {
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
      await screen.findByLabelText(labels.reopenToReady.commentLabel),
      "Reopening for the release",
    );
    await user.click(
      screen.getByRole("button", { name: labels.reopenToReady.confirm }),
    );

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
      expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute(
        "data-state",
        "active",
      );
      expect(screen.getByRole("tab", { name: "Calendar" })).toBeEnabled();
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
