import type { DragEndEvent } from "@dnd-kit/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import type { JobsListFilters } from "@/app/tasks/utils/jobs-filters";
import type { TasksFilters } from "@/app/tasks/utils/tasks-filters";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import type { AgentJobStatus } from "@/lib/clients/generated/core";
import { TaskStatus } from "@/lib/clients/generated/core";
import { TasksView } from "./tasks-view";

const {
  dndContextPropsSpy,
  pushMock,
  refreshMock,
  replaceMock,
  showCalendarClientUpgradeModalMock,
} = vi.hoisted(() => ({
  dndContextPropsSpy: vi.fn(),
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
  KanbanBoard: ({ tasks }: { tasks: TaskWithCoworker[] }) => (
    <div>
      {tasks.map((task) => (
        <div
          key={task.id}
          data-testid={`board-card-${task.id}`}
          data-column={task.columnId}
          data-status={task.status}
        />
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
  loadJobsTabData: vi.fn(),
  loadMoreJobs: vi.fn(),
  loadMoreTasksColumn: vi.fn(),
  loadMoreTasksList: vi.fn(),
}));

vi.mock("./create-task-modal", () => ({
  CreateTaskModal: () => null,
  CreateTaskModalProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useCreateTaskModal: () => ({
    handleOpen: vi.fn(),
    handleOpenWithDefaults: vi.fn(),
  }),
}));

vi.mock("./jobs-list-view", () => ({ JobsListView: () => null }));
vi.mock("./jobs-view-filters", () => ({ JobsViewFilters: () => null }));
vi.mock("./tasks-view-filters", () => ({ TasksViewFilters: () => null }));
vi.mock("./tasks-project-switcher", () => ({
  TasksProjectSwitcher: () => null,
}));
vi.mock("./task-list-view", () => ({ TaskListView: () => null }));
vi.mock("./task-list-item", () => ({ TaskListItem: () => null }));
vi.mock("./task-card", () => ({ TaskCard: () => null }));
vi.mock("./view-mode-switch", () => ({ ViewModeSwitch: () => null }));
vi.mock("./tasks-empty-state-overlay", () => ({
  TasksEmptyStateOverlay: () => null,
}));
vi.mock("@/app/components/list-mobile-create-fab", () => ({
  ListMobileCreateFab: () => null,
}));

const SCHEDULED_TASK: TaskWithCoworker = {
  id: "task-1",
  name: "Weekly report",
  status: TaskStatus.DRAFT,
  ownerId: "user-1",
  owner: { id: "user-1", name: "Ada", email: "ada@example.com" },
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:00:00.000Z",
  jobsCount: 0,
  commentsCount: 0,
  columnId: "backlog",
  events: [],
  agents: [],
  assignee: { id: "coworker-1", name: "Soko", kind: "coworker" },
  metadata: JSON.stringify({ version: 2, mode: "recurring" }),
  nextRunAt: "2026-06-25T09:00:00.000Z",
} as TaskWithCoworker;

const CANCELED_SCHEDULED_TASK: TaskWithCoworker = {
  ...SCHEDULED_TASK,
  status: TaskStatus.CANCELED,
  columnId: "done",
};

const labels = {
  tabs: { tasks: "Tasks", jobs: "Jobs" },
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
    statusOptions: {} as Record<TaskStatus, string>,
  },
  columns: {
    backlog: "Backlog",
    todo: "To do",
    "in-progress": "In progress",
    "input-required": "Input required",
    done: "Done",
  } as Record<KanbanColumnId, string>,
  add: "Add",
  addTask: "Add task",
  jobs: {
    filterButton: "Filter",
    agentLabel: "Agent",
    jobStatusLabel: "Status",
    jobStatusOptions: {} as Record<AgentJobStatus, string>,
    recentTitle: "Recent",
    emptyRecent: "No recent jobs",
    emptyList: "No jobs",
    emptySection: "Nothing here",
    untitled: "Untitled",
    unknownAgent: "Unknown agent",
  },
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
  scheduleActiveError: "This task runs on a schedule",
  loadMoreError: "Could not load more",
  loadJobsError: "Could not load jobs",
  reopenToReady: {
    title: "Reopen task",
    description: "Say why",
    commentLabel: "Comment",
    commentPlaceholder: "Why reopen?",
    confirm: "Reopen",
    cancel: "Cancel",
    commentRequired: "A comment is required",
  },
  emptyState: {
    title: "No tasks yet",
    description: "Create one",
    getStartedTitle: "Get started",
    getStartedDescription: "Add your first task",
    getStartedButton: "Add task",
    next: "Next",
    back: "Back",
    addTaskHint: "Add a task",
    elenaAvatarAlt: "Elena",
  },
  showGuideAriaLabel: "Show guide",
} satisfies ComponentProps<typeof TasksView>["labels"];

const EMPTY_FILTERS: TasksFilters = {
  scope: "owned",
  assigneeId: null,
  assigneeSokoBotId: null,
  assigneeUserId: null,
  status: null,
  projectId: null,
};

const EMPTY_JOBS_FILTERS: JobsListFilters = {
  scope: "owned",
  agentId: null,
  jobStatus: null,
  projectId: null,
};

function renderBoard(tasks: TaskWithCoworker[] = [SCHEDULED_TASK]) {
  return render(
    <TasksView
      tasks={tasks}
      listNextCursor={null}
      columnNextCursorById={
        {
          backlog: null,
          todo: null,
          "in-progress": null,
          "input-required": null,
          done: null,
        } as Record<KanbanColumnId, string | null>
      }
      coworkerOptions={[]}
      projectOptions={[]}
      userId={null}
      activeOrganizationId={null}
      initialFilters={EMPTY_FILTERS}
      initialJobsListFilters={EMPTY_JOBS_FILTERS}
      defaultViewMode="board"
      canCreateTask
      labels={labels}
    />,
  );
}

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

  it("restores a scheduled task rejected with schedule_active and says why", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: false,
      error: { kind: "schedule_active" },
    });
    renderBoard();

    await dropOnTodo("task-1", "backlog");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(labels.scheduleActiveError, {
        duration: Infinity,
      }),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-column", "backlog");
    expect(boardCard("task-1")).toHaveAttribute(
      "data-status",
      TaskStatus.DRAFT,
    );
    expect(showCalendarClientUpgradeModalMock).not.toHaveBeenCalled();
  });

  it("gives a quarantined series its own copy rather than the upgrade modal", async () => {
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: false,
      error: { kind: "schedule_quarantined" },
    });
    renderBoard();

    await dropOnTodo("task-1", "backlog");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("quarantined", {
        duration: Infinity,
      }),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-column", "backlog");
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
      error: { kind: "schedule_active" },
    });
    renderBoard([CANCELED_SCHEDULED_TASK]);

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
      expect(toast.error).toHaveBeenCalledWith(labels.scheduleActiveError, {
        duration: Infinity,
      }),
    );
    expect(boardCard("task-1")).toHaveAttribute("data-column", "done");
    expect(boardCard("task-1")).toHaveAttribute(
      "data-status",
      TaskStatus.CANCELED,
    );
    expect(showCalendarClientUpgradeModalMock).not.toHaveBeenCalled();
  });
});
