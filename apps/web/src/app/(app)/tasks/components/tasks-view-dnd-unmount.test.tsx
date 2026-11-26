import { useDraggable, useDroppable } from "@dnd-kit/core";
import { TaskStatus } from "@sokosumi/core-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import type { TasksFilters } from "@/app/tasks/utils/tasks-filters";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { TasksView } from "./tasks-view";

const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
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
    showCalendarClientUpgradeModal: vi.fn(),
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
    handleOpen: vi.fn(),
    handleOpenWithDefaults: vi.fn(),
  }),
}));

vi.mock("./tasks-view-filters", () => ({
  focusToolbarControl: vi.fn(),
  TasksViewFilters: () => <div />,
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: vi.fn(),
  }),
}));

vi.mock("@/app/components/list-mobile-create-fab", () => ({
  ListMobileCreateFab: () => null,
}));

function DraggableStubCard({ task }: { task: TaskWithCoworker }) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: task.id,
    data: { columnId: task.columnId },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`dnd-card-${task.id}`}
      data-dragging={String(isDragging)}
      {...attributes}
      {...listeners}
    >
      {task.name}
    </div>
  );
}

function DroppableStubColumn({
  id,
  children,
}: {
  id: KanbanColumnId;
  children?: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-testid={`dnd-column-${id}`}
      data-over={String(isOver)}
    >
      {children}
    </div>
  );
}

vi.mock("./kanban-board", () => ({
  KanbanBoard: ({
    tasks,
    isDragEnabled = true,
  }: {
    tasks: TaskWithCoworker[];
    isDragEnabled?: boolean;
  }) => (
    <div data-testid="dnd-board" data-dnd-enabled={String(isDragEnabled)}>
      <DroppableStubColumn id="backlog">
        {tasks
          .filter((task) => task.columnId === "backlog")
          .map((task) => (
            <DraggableStubCard key={task.id} task={task} />
          ))}
      </DroppableStubColumn>
      <DroppableStubColumn id="todo">
        {tasks
          .filter((task) => task.columnId === "todo")
          .map((task) => (
            <DraggableStubCard key={task.id} task={task} />
          ))}
      </DroppableStubColumn>
    </div>
  ),
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

function taggedBoard(tag: string, tasks: TaskWithCoworker[]) {
  searchParamsRef.current = new URLSearchParams({ tag });
  return (
    <TasksView
      tasks={tasks}
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
      projectOptions={[]}
      userId={null}
      activeOrganizationId={null}
      initialFilters={{ ...EMPTY_FILTERS, tag }}
      defaultViewMode="board"
      canCreateTask
      labels={labels}
    />
  );
}

function makePointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
    isPrimary: true,
    pointerId: 1,
  });
}

describe("TasksView real PointerSensor unmount guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setTaskStatusFromDrag).mockResolvedValue({
      ok: true,
    } as Awaited<ReturnType<typeof setTaskStatusFromDrag>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    searchParamsRef.current = new URLSearchParams();
  });

  it("ignores a late PointerSensor drop delivered after the board remounted for a new filter", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "dnd-column-todo") {
          return new DOMRect(200, 0, 150, 300);
        }
        if (this.dataset.testid === "dnd-column-backlog") {
          return new DOMRect(0, 0, 150, 300);
        }
        return new DOMRect(0, 0, 100, 100);
      },
    );

    const { getByTestId, rerender } = render(
      taggedBoard("research", [TASK]),
      // TasksView reads the search query through nuqs.
      { wrapper: NuqsTestingAdapter },
    );

    // Wait for hydrationStore's requestAnimationFrame so the real DndContext mounts.
    await waitFor(() =>
      expect(getByTestId("dnd-board")).toHaveAttribute(
        "data-dnd-enabled",
        "true",
      ),
    );
    const card = getByTestId("dnd-card-task-1");

    // Start a real pointer drag on filter A and hold the pointer over To do.
    await act(async () => {
      fireEvent(card, makePointerEvent("pointerdown", 20, 20));
    });
    await act(async () => {
      fireEvent(document, makePointerEvent("pointermove", 40, 20));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    await act(async () => {
      fireEvent(document, makePointerEvent("pointermove", 250, 50));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    // Confirm the drag activated and is hovering over To do before the filter changes.
    expect(card).toHaveAttribute("data-dragging", "true");
    await waitFor(() =>
      expect(getByTestId("dnd-column-todo")).toHaveAttribute(
        "data-over",
        "true",
      ),
    );

    // Filter B commits without `task-1`, unmounting filter A's keyed TasksBoard.
    rerender(taggedBoard("writing", []));

    const removeDocumentListener = vi.spyOn(document, "removeEventListener");

    // Releasing the pointer delivers pointerup to filter A's document listener.
    await act(async () => {
      fireEvent(document, makePointerEvent("pointerup", 250, 50));
    });

    // @dnd-kit's PointerSensor.detach() removes its document listeners on a
    // 50ms timeout; wait for it to finish before teardown aborts pending timers
    // so selectionchange/click listeners do not leak across files.
    await waitFor(() =>
      expect(removeDocumentListener).toHaveBeenCalledWith(
        "selectionchange",
        expect.any(Function),
        undefined,
      ),
    );

    expect(setTaskStatusFromDrag).not.toHaveBeenCalled();
  });
});
