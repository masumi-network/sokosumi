import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type ComponentProps,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import {
  getTaskLinkActionInput,
  TASK_STATUS,
  type TaskStatus,
} from "@/app/tasks/components/task-detail-api-types";
import {
  createTaskAndLink,
  createTaskLink,
  deleteTask,
  deleteTaskLink,
  setTaskStatusFromDrag,
} from "@/lib/actions/task/action";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { TaskLinkRelation } from "@/lib/clients/generated/core/types.gen";
import { mockCoworkerOption } from "@/test-fixtures/coworker";

const { pushMock, refreshMock, browserCoreClientMock, isMobileMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    browserCoreClientMock: {
      getTasks: vi.fn(),
    },
    isMobileMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (_namespace?: string) => (key: string, values?: Record<string, string>) => {
      const translations: Record<string, string> = {
        moveToWorkspace: "Move to workspace",
        markAs: "Mark as",
        createRelated: "Create related",
        removeRelated: "Remove related",
        removeParent: "Remove parent",
        removeRelatedSuccess: "Related task removed",
        removeRelatedError: "Failed to remove related task",
        taskPickerLoading: "Loading tasks...",
        taskPickerLoadMore: "Load more tasks",
        taskPickerError: "Failed to load tasks",
        taskPickerLoadMoreError: "Failed to load more tasks",
        "relations.related": "Related",
        "relations.blocks": "Blocks",
        "relations.blockedBy": "Blocked by",
        "relations.subtask": "Sub-task",
        "relations.duplicate": "Duplicate",
        "relations.addSubtask": "Add sub-task",
        taskPickerSearchPlaceholder: "Search tasks...",
        taskPickerDescription: "Choose a task to link with the current task.",
        taskPickerEmpty: "No tasks found.",
        createRelatedDialogTitle: `Create ${values?.relation ?? ""}`.trim(),
      };

      return translations[key] ?? key;
    },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: isMobileMock,
}));

vi.mock("@/components/ui/command", () => ({
  CommandDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  CommandInput: ({
    placeholder,
    value,
    onValueChange,
  }: {
    placeholder?: string;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  interface DropdownMenuContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
  }

  interface DropdownMenuSubContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
  }

  const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
    null,
  );
  const DropdownMenuSubContext =
    createContext<DropdownMenuSubContextValue | null>(null);

  function DropdownMenu({
    children,
    open: openProp,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = openProp ?? uncontrolledOpen;

    const setOpen = (nextOpen: boolean) => {
      if (typeof openProp === "undefined") {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    };

    return (
      <DropdownMenuContext.Provider value={{ open, setOpen }}>
        <div>{children}</div>
      </DropdownMenuContext.Provider>
    );
  }

  function DropdownMenuTrigger({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) {
    const context = useContext(DropdownMenuContext);
    if (!context) return null;

    const handleClick = () => {
      context.setOpen(!context.open);
    };

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
        onClick: handleClick,
      });
    }

    return (
      <button type="button" onClick={handleClick}>
        {children}
      </button>
    );
  }

  function DropdownMenuContent({ children }: { children: ReactNode }) {
    const context = useContext(DropdownMenuContext);

    if (!context?.open) {
      return null;
    }

    return <div>{children}</div>;
  }

  function DropdownMenuItem({
    children,
    onSelect,
    disabled,
    asChild,
  }: {
    children: ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
    asChild?: boolean;
  }) {
    const context = useContext(DropdownMenuContext);

    const handleSelect = () => {
      if (!context || disabled) return;

      let defaultPrevented = false;
      onSelect?.({
        preventDefault: () => {
          defaultPrevented = true;
        },
      });

      if (!defaultPrevented) {
        context.setOpen(false);
      }
    };

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
        onClick: handleSelect,
      });
    }

    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={handleSelect}
      >
        {children}
      </button>
    );
  }

  function DropdownMenuSeparator() {
    return <div data-slot="dropdown-menu-separator" />;
  }

  function DropdownMenuSub({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
      <DropdownMenuSubContext.Provider value={{ open, setOpen }}>
        <div>{children}</div>
      </DropdownMenuSubContext.Provider>
    );
  }

  function DropdownMenuSubTrigger({
    children,
    disabled,
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) {
    const context = useContext(DropdownMenuSubContext);

    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => context?.setOpen(!context.open)}
      >
        {children}
      </button>
    );
  }

  function DropdownMenuSubContent({ children }: { children: ReactNode }) {
    const context = useContext(DropdownMenuSubContext);

    if (!context?.open) {
      return null;
    }

    return <div>{children}</div>;
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
  };
});

vi.mock("@/lib/actions/task/action", () => ({
  setTaskStatusFromDrag: vi.fn(),
  deleteTask: vi.fn(),
  moveTaskToWorkspace: vi.fn(),
  createTaskLink: vi.fn(),
  createTaskAndLink: vi.fn(),
  deleteTaskLink: vi.fn(),
}));

vi.mock("@/lib/clients/core.browser.client", () => {
  class TestCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return {
    CoreApiRequestError: TestCoreApiRequestError,
    coreClient: browserCoreClientMock,
  };
});

vi.mock("@/app/tasks/components/move-task-to-workspace-dialog", () => ({
  MoveTaskToWorkspaceDialog: () => null,
}));

vi.mock("@/app/tasks/components/task-form-modal", () => ({
  TaskFormModal: ({
    open,
    children,
    title,
  }: {
    open: boolean;
    children: ReactNode;
    title: string;
  }) =>
    open ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock("@/app/tasks/components/task-share-button", () => ({
  TaskShareButton: ({ label }: { label: string }) => <button>{label}</button>,
}));

vi.mock("@/app/tasks/components/task-form", () => ({
  TaskForm: ({
    initialValues,
    onCreateTask,
    onSuccess,
  }: {
    initialValues?: { coworkerId?: string | null };
    onCreateTask?: (input: {
      description: string;
      coworkerId: string | null;
      status: TaskStatus;
    }) => Promise<{ taskId: string }>;
    onSuccess?: (taskId: string) => void;
  }) => (
    <div>
      <span>{initialValues?.coworkerId ?? "no-coworker"}</span>
      <button
        type="button"
        onClick={async () => {
          if (!onCreateTask) return;
          const result = await onCreateTask({
            description: "Created related task",
            coworkerId: initialValues?.coworkerId ?? null,
            status: TASK_STATUS.READY,
          });
          onSuccess?.(result.taskId);
        }}
      >
        Submit related task
      </button>
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function buildTaskListItem(
  overrides?: Partial<{ id: string; name: string; status: TaskStatus }>,
) {
  return {
    id: "task-2",
    createdAt: new Date("2026-03-31T10:00:00.000Z"),
    updatedAt: new Date("2026-03-31T10:00:00.000Z"),
    userId: "user-1",
    organizationId: null,
    coworkerId: null,
    name: "Alpha task",
    description: null,
    status: TASK_STATUS.READY,
    credits: 0,
    events: [],
    jobs: [],
    ...overrides,
  };
}

const labels = {
  edit: "Edit",
  archive: "Archive",
  confirmArchive: "Confirm archive",
  confirmArchiveDescription: "Are you sure?",
  archiveError: "Archive error",
  markAsReady: "Mark as Ready",
  revertToDraft: "Revert to Draft",
  cancelRequest: "Cancel Request",
  share: "Share",
};

const actionsMenuLabel = "Actions";

const personalWorkspaceLabel = "Test User";

const sampleOrganizations = [
  { organization: { id: "org-2", name: "Other Org" } },
] as unknown as MemberWithOrganization[];

const defaultTaskLinks = [
  {
    id: "link-parent",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    relation: "child",
    note: null,
    peerTask: {
      id: "task-parent",
      name: "Parent task",
      status: TASK_STATUS.READY,
      archivedAt: null,
    },
  },
] as const;

const removableTaskLinks = [
  {
    id: "link-related",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    relation: TaskLinkRelation.RELATED,
    note: null,
    peerTask: {
      id: "task-related",
      name: "Related task",
      status: TASK_STATUS.READY,
      archivedAt: null,
    },
  },
  {
    id: "link-blocks",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    relation: TaskLinkRelation.BLOCKS,
    note: null,
    peerTask: {
      id: "task-blocked",
      name: "Blocked task",
      status: TASK_STATUS.DRAFT,
      archivedAt: null,
    },
  },
  {
    id: "link-subtask",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    relation: TaskLinkRelation.PARENT,
    note: null,
    peerTask: {
      id: "task-subtask",
      name: "Sub-task",
      status: TASK_STATUS.READY,
      archivedAt: null,
    },
  },
  {
    id: "link-archived",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    relation: TaskLinkRelation.DUPLICATE,
    note: null,
    peerTask: {
      id: "task-archived",
      name: "Archived duplicate",
      status: TASK_STATUS.CANCELED,
      archivedAt: new Date("2024-01-02T00:00:00.000Z"),
    },
  },
] as const;

const coworkerOptions = [
  mockCoworkerOption({
    id: "coworker-1",
    slug: "elena",
    name: "Elena",
  }),
];

function renderActions(
  props?: Partial<ComponentProps<typeof TaskDetailActions>>,
) {
  return render(
    <TaskDetailActions
      taskId="task-1"
      share={null}
      status={TASK_STATUS.READY}
      jobsCount={0}
      taskLinks={[]}
      coworkerOptions={coworkerOptions}
      agentNameById={new Map()}
      defaultCoworkerId="coworker-1"
      actionsMenuLabel={actionsMenuLabel}
      labels={labels}
      organizations={sampleOrganizations}
      personalWorkspaceLabel={personalWorkspaceLabel}
      isReadOnly={false}
      {...props}
    />,
  );
}

describe("TaskDetailActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMobileMock.mockReturnValue(false);
    browserCoreClientMock.getTasks.mockReset();
    vi.mocked(setTaskStatusFromDrag).mockReset();
    vi.mocked(createTaskLink).mockReset();
    vi.mocked(createTaskAndLink).mockReset();
    vi.mocked(deleteTask).mockReset();
    vi.mocked(deleteTaskLink).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELED,
  ] as const)("shows archive in the overflow menu for finalized status %s without edit", async (status) => {
    const user = userEvent.setup();
    renderActions({ status });

    expect(screen.getByRole("button", { name: labels.share })).toBeVisible();
    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Revert to Draft" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Mark as Ready" }),
    ).toBeNull();
  });

  it("shows edit for queued tasks", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TASK_STATUS.QUEUED,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(screen.getByRole("link", { name: labels.edit })).toBeInTheDocument();
  });

  it("hides archive while the coworker is running", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TASK_STATUS.RUNNING,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(screen.queryByRole("menuitem", { name: labels.archive })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: labels.cancelRequest }),
    ).toBeInTheDocument();
  });

  it("shows cancel request while approval is required", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TASK_STATUS.APPROVAL_REQUIRED,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(screen.queryByRole("menuitem", { name: labels.archive })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: labels.cancelRequest }),
    ).toBeInTheDocument();
  });

  it("shows archive for the task owner while vendor grant approval is pending", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TASK_STATUS.APPROVAL_REQUIRED,
      organizations: undefined,
      pendingApproval: true,
      isTaskOwner: true,
      isReadOnly: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
  });

  it("hides share and overflow actions in read-only workspace mode", () => {
    renderActions({
      isReadOnly: true,
    });

    expect(
      screen.queryByRole("button", { name: labels.share }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: actionsMenuLabel }),
    ).not.toBeInTheDocument();
  });

  it("disables the actions trigger while a status update is pending", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{ taskId: string }>();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockReturnValueOnce(deferred.promise);

    renderActions({
      status: TASK_STATUS.DRAFT,
      organizations: undefined,
    });

    const actionsButton = screen.getByRole("button", {
      name: actionsMenuLabel,
    });
    await user.click(actionsButton);
    await user.click(screen.getByRole("menuitem", { name: "Mark as Ready" }));

    await waitFor(() => {
      expect(actionsButton).toBeDisabled();
    });

    expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
      taskId: "task-1",
      desiredStatus: TASK_STATUS.READY,
    });

    deferred.resolve({ taskId: "task-1" });

    await waitFor(() => {
      expect(actionsButton).not.toBeDisabled();
    });
  });

  it("runs status actions from the overflow menu", async () => {
    const user = userEvent.setup();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockResolvedValueOnce({ taskId: "task-1" });

    renderActions({
      status: TASK_STATUS.DRAFT,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as Ready" }));

    await waitFor(() => {
      expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TASK_STATUS.READY,
      });
    });
  });

  it("renders archive without status reopen actions for canceled tasks", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TASK_STATUS.CANCELED,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Revert to Draft" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Mark as Ready" }),
    ).toBeNull();
  });

  it("shows move to workspace when the task can be moved", async () => {
    const user = userEvent.setup();

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    ).toBeInTheDocument();
  });

  it("shows move for an organization task even when memberships are empty (personal is still a target)", async () => {
    const user = userEvent.setup();

    renderActions({
      currentOrganizationId: "org-current",
      organizations: [],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    ).toBeInTheDocument();
  });

  it("hides move for a personal task when the user has no organizations", async () => {
    const user = userEvent.setup();

    renderActions({
      currentOrganizationId: null,
      organizations: [],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.queryByRole("menuitem", { name: "Move to workspace" }),
    ).not.toBeInTheDocument();
  });

  it("keeps move to workspace available when the task already has jobs", async () => {
    const user = userEvent.setup();

    renderActions({
      jobsCount: 1,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    ).toBeInTheDocument();
  });

  it("loads task options from the browser core client when the picker opens", async () => {
    const user = userEvent.setup();
    browserCoreClientMock.getTasks.mockResolvedValue({
      data: [
        buildTaskListItem(),
        buildTaskListItem({
          id: "task-1",
          name: "Current task",
        }),
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 1,
          nextCursor: null,
        },
      },
    });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    await waitFor(() => {
      expect(browserCoreClientMock.getTasks).toHaveBeenCalledWith({
        q: undefined,
        cursor: undefined,
        limit: 20,
      });
    });

    expect(
      await screen.findByRole("button", { name: "Alpha task" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Current task" }),
    ).not.toBeInTheDocument();
  });

  it("debounces task search and links an existing task", async () => {
    const user = userEvent.setup();
    browserCoreClientMock.getTasks
      .mockResolvedValueOnce({
        data: [buildTaskListItem()],
        meta: {
          pagination: {
            cursor: null,
            limit: 20,
            total: 1,
            nextCursor: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: [
          buildTaskListItem({
            id: "task-3",
            name: "Beta task",
          }),
        ],
        meta: {
          pagination: {
            cursor: null,
            limit: 20,
            total: 1,
            nextCursor: null,
          },
        },
      });
    const createTaskLinkMock = vi.mocked(createTaskLink);
    createTaskLinkMock.mockResolvedValue({
      taskId: "task-1",
      relatedTaskId: "task-3",
      linkId: "link-2",
    });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    const searchInput = await screen.findByRole("textbox", {
      name: "Search tasks...",
    });
    await user.type(searchInput, "Beta");

    await waitFor(
      () => {
        expect(browserCoreClientMock.getTasks).toHaveBeenLastCalledWith({
          q: "Beta",
          cursor: undefined,
          limit: 20,
        });
      },
      { timeout: 2000 },
    );

    await user.click(await screen.findByRole("button", { name: "Beta task" }));

    await waitFor(() => {
      expect(createTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        relatedTaskId: "task-3",
        ...getTaskLinkActionInput(TaskLinkRelation.RELATED),
      });
    });
  });

  it("shows loading only on the selected linkable task while all picker rows stay disabled", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{
      taskId: string;
      relatedTaskId: string;
      linkId: string;
    }>();
    browserCoreClientMock.getTasks.mockResolvedValue({
      data: [
        buildTaskListItem(),
        buildTaskListItem({
          id: "task-3",
          name: "Beta task",
          status: TASK_STATUS.DRAFT,
        }),
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 2,
          nextCursor: null,
        },
      },
    });
    const createTaskLinkMock = vi.mocked(createTaskLink);
    createTaskLinkMock.mockReturnValueOnce(deferred.promise);

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    const alphaTaskButton = await screen.findByRole("button", {
      name: "Alpha task",
    });
    const betaTaskButton = screen.getByRole("button", { name: "Beta task" });

    await user.click(alphaTaskButton);

    await waitFor(() => {
      expect(createTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        relatedTaskId: "task-2",
        ...getTaskLinkActionInput(TaskLinkRelation.RELATED),
      });
      expect(alphaTaskButton).toBeDisabled();
      expect(betaTaskButton).toBeDisabled();
      expect(alphaTaskButton.querySelector(".animate-spin")).toBeTruthy();
      expect(betaTaskButton.querySelector(".animate-spin")).toBeNull();
    });

    deferred.resolve({
      taskId: "task-1",
      relatedTaskId: "task-2",
      linkId: "link-2",
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Alpha task" }),
      ).not.toBeInTheDocument();
    });
  });

  it("appends more task options when load more is selected", async () => {
    const user = userEvent.setup();
    browserCoreClientMock.getTasks
      .mockResolvedValueOnce({
        data: [buildTaskListItem()],
        meta: {
          pagination: {
            cursor: null,
            limit: 20,
            total: 2,
            nextCursor: "task-2",
          },
        },
      })
      .mockResolvedValueOnce({
        data: [
          buildTaskListItem({
            id: "task-4",
            name: "Gamma task",
          }),
        ],
        meta: {
          pagination: {
            cursor: "task-2",
            limit: 20,
            total: 2,
            nextCursor: null,
          },
        },
      });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    expect(
      await screen.findByRole("button", { name: "Alpha task" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more tasks" }));

    await waitFor(() => {
      expect(browserCoreClientMock.getTasks).toHaveBeenNthCalledWith(2, {
        q: undefined,
        cursor: "task-2",
        limit: 20,
      });
    });

    expect(
      await screen.findByRole("button", { name: "Gamma task" }),
    ).toBeInTheDocument();
  });

  it("renders an inline picker error when task loading fails", async () => {
    const user = userEvent.setup();
    browserCoreClientMock.getTasks.mockRejectedValue(new Error("load failed"));

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    expect(await screen.findByText("Failed to load tasks")).toBeInTheDocument();
  });

  it("opens the create related modal and submits through createTaskAndLink", async () => {
    const user = userEvent.setup();
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createTaskAndLinkMock.mockResolvedValue({
      taskId: "task-1",
      createdTaskId: "task-created",
      linkId: "link-created",
      name: "Created related task",
    });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Add sub-task" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        description: "Created related task",
        coworkerId: "coworker-1",
        status: TASK_STATUS.READY,
        ...getTaskLinkActionInput(TaskLinkRelation.PARENT),
      });
    });

    expect(pushMock).toHaveBeenCalledWith("/tasks/task-created");
  });

  it("shows remove parent when the task has a parent link", async () => {
    const user = userEvent.setup();
    const deleteTaskLinkMock = vi.mocked(deleteTaskLink);
    deleteTaskLinkMock.mockResolvedValue({
      taskId: "task-1",
      linkId: "link-parent",
      relatedTaskId: "task-parent",
    });

    renderActions({
      taskLinks: [...defaultTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Remove parent" }));

    await waitFor(() => {
      expect(deleteTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        linkId: "link-parent",
      });
    });
  });

  it("remove parent deletes every child-relation link when multiple exist", async () => {
    const user = userEvent.setup();
    const deleteTaskLinkMock = vi.mocked(deleteTaskLink);
    deleteTaskLinkMock.mockResolvedValue({
      taskId: "task-1",
      linkId: "link-parent",
      relatedTaskId: "task-parent",
    });

    const secondParentLink = {
      id: "link-parent-2",
      createdAt: new Date("2024-01-02T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
      relation: TaskLinkRelation.CHILD,
      note: null,
      peerTask: {
        id: "task-parent-2",
        name: "Other parent",
        status: TASK_STATUS.READY,
        archivedAt: null,
      },
    } as const;

    renderActions({
      taskLinks: [...defaultTaskLinks, secondParentLink],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Remove parent" }));

    await waitFor(() => {
      expect(deleteTaskLinkMock).toHaveBeenCalledTimes(2);
      expect(deleteTaskLinkMock).toHaveBeenNthCalledWith(1, {
        taskId: "task-1",
        linkId: "link-parent",
      });
      expect(deleteTaskLinkMock).toHaveBeenNthCalledWith(2, {
        taskId: "task-1",
        linkId: "link-parent-2",
      });
    });
  });

  it("shows remove related only for non-parent visible links", async () => {
    const user = userEvent.setup();

    renderActions({
      taskLinks: [...defaultTaskLinks, ...removableTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: "Remove related" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Remove related" }));
    expect(
      screen.getByRole("menuitem", { name: "Related task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Blocked task" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("menuitem", { name: "Sub-task" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("menuitem", { name: "Parent task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Archived duplicate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Remove parent" }),
    ).toBeInTheDocument();
  });

  it("hides remove related when there are no removable links", async () => {
    const user = userEvent.setup();

    renderActions({
      taskLinks: [...defaultTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.queryByRole("menuitem", { name: "Remove related" }),
    ).not.toBeInTheDocument();
  });

  it("removes a selected related link and shows success feedback", async () => {
    const user = userEvent.setup();
    const deleteTaskLinkMock = vi.mocked(deleteTaskLink);
    deleteTaskLinkMock.mockResolvedValue({
      taskId: "task-1",
      linkId: "link-related",
      relatedTaskId: "task-related",
    });

    renderActions({
      taskLinks: [...removableTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Remove related" }));
    await user.click(screen.getByRole("menuitem", { name: "Related task" }));

    await waitFor(() => {
      expect(deleteTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        linkId: "link-related",
      });
      expect(refreshMock).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Related task removed");
    });
  });

  it("shows an error toast when removing a related link fails", async () => {
    const user = userEvent.setup();
    const deleteTaskLinkMock = vi.mocked(deleteTaskLink);
    deleteTaskLinkMock.mockRejectedValue(new Error("remove failed"));

    renderActions({
      taskLinks: [...removableTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Remove related" }));
    await user.click(screen.getByRole("menuitem", { name: "Related task" }));

    await waitFor(() => {
      expect(deleteTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        linkId: "link-related",
      });
      expect(toast.error).toHaveBeenCalledWith("Failed to remove related task");
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("renders grouped separators for status, relation, workspace, and archive sections", async () => {
    const user = userEvent.setup();
    renderActions({
      taskLinks: [...defaultTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      document.querySelectorAll('[data-slot="dropdown-menu-separator"]').length,
    ).toBe(3);
  });

  it("archives the task from the confirmation dialog", async () => {
    const user = userEvent.setup();
    const deleteTaskMock = vi.mocked(deleteTask);
    deleteTaskMock.mockResolvedValue({ taskId: "task-1" });

    renderActions({ organizations: undefined });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: labels.archive }));

    expect(
      await screen.findByRole("heading", { name: labels.confirmArchive }),
    ).toBeVisible();

    await user.click(
      screen.getAllByRole("button", { name: labels.archive }).at(-1)!,
    );

    await waitFor(() => {
      expect(deleteTaskMock).toHaveBeenCalledWith({ taskId: "task-1" });
      expect(pushMock).toHaveBeenCalledWith("/tasks");
    });
  });

  it("keeps desktop submenu behavior for mark as actions", async () => {
    const user = userEvent.setup();
    browserCoreClientMock.getTasks.mockResolvedValue({
      data: [buildTaskListItem()],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 1,
          nextCursor: null,
        },
      },
    });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    expect(screen.queryByRole("menuitem", { name: "Related" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getByRole("menuitem", { name: "Related" }));

    await waitFor(() => {
      expect(browserCoreClientMock.getTasks).toHaveBeenCalled();
    });
  });

  it("expands mark as inline on mobile and opens the picker", async () => {
    const user = userEvent.setup();
    isMobileMock.mockReturnValue(true);
    browserCoreClientMock.getTasks.mockResolvedValue({
      data: [buildTaskListItem()],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 1,
          nextCursor: null,
        },
      },
    });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    expect(screen.queryByRole("menuitem", { name: "Related" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));
    await user.click(screen.getByRole("menuitem", { name: "Related" }));

    await waitFor(() => {
      expect(browserCoreClientMock.getTasks).toHaveBeenCalled();
    });
  });

  it("expands create related inline on mobile and still opens the modal flow", async () => {
    const user = userEvent.setup();
    isMobileMock.mockReturnValue(true);
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createTaskAndLinkMock.mockResolvedValue({
      taskId: "task-1",
      createdTaskId: "task-created",
      linkId: "link-created",
      name: "Created related task",
    });

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    expect(screen.queryByRole("menuitem", { name: "Add sub-task" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(screen.getByRole("menuitem", { name: "Add sub-task" }));
    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        description: "Created related task",
        coworkerId: "coworker-1",
        status: TASK_STATUS.READY,
        ...getTaskLinkActionInput(TaskLinkRelation.PARENT),
      });
    });

    expect(pushMock).toHaveBeenCalledWith("/tasks/task-created");
  });

  it("expands remove related inline on mobile and removes the selected task", async () => {
    const user = userEvent.setup();
    isMobileMock.mockReturnValue(true);
    const deleteTaskLinkMock = vi.mocked(deleteTaskLink);
    deleteTaskLinkMock.mockResolvedValue({
      taskId: "task-1",
      linkId: "link-related",
      relatedTaskId: "task-related",
    });

    renderActions({
      taskLinks: [...removableTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    expect(screen.queryByRole("menuitem", { name: "Related task" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Remove related" }));
    await user.click(screen.getByRole("menuitem", { name: "Related task" }));

    await waitFor(() => {
      expect(deleteTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        linkId: "link-related",
      });
    });
  });

  it("resets expanded mobile sections when the dropdown closes", async () => {
    const user = userEvent.setup();
    isMobileMock.mockReturnValue(true);

    renderActions();

    const actionsButton = screen.getByRole("button", {
      name: actionsMenuLabel,
    });

    await user.click(actionsButton);
    await user.click(screen.getByRole("menuitem", { name: "Mark as" }));

    expect(
      screen.getByRole("menuitem", { name: "Related" }),
    ).toBeInTheDocument();

    await user.click(actionsButton);
    await user.click(actionsButton);

    expect(screen.queryByRole("menuitem", { name: "Related" })).toBeNull();
  });
});
