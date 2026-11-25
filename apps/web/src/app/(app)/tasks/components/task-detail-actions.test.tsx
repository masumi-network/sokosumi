import type { MemberWithOrganization } from "@sokosumi/core-client";
import { TaskLinkRelation, TaskStatus } from "@sokosumi/core-client";
import { expectConsole } from "@sokosumi/utils/test-console";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Activity,
  type ComponentProps,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  startTransition,
  useContext,
  useState,
} from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import {
  TaskDetailStatusProvider,
  useOptimisticTaskStatus,
} from "@/app/tasks/components/task-detail-optimistic";
import { TaskDetailLinksProvider } from "@/app/tasks/components/task-detail-optimistic-links";
import { TaskRelatedTasks } from "@/app/tasks/components/task-related-tasks";
import {
  isTaskArchived,
  isTaskArchivePending,
  unmarkTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";
import {
  MAX_SUBTASK_DEPTH,
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import {
  type CreateTaskResult,
  createTaskAndLink,
  createTaskLink,
  deleteTaskLink,
  revalidateTasksAfterArchive,
  setTaskStatusFromDrag,
} from "@/lib/actions/task/action";
import { mockCoworkerOption } from "@/test-fixtures/coworker";
import { mapVisibleTaskLinks } from "./task-detail-api-types";
import { taskSubtasksQueryKey } from "./use-task-subtasks";

const {
  pushMock,
  refreshMock,
  browserCoreClientMock,
  isMobileMock,
  showCalendarClientUpgradeModalMock,
  createRelatedVisibilityMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  browserCoreClientMock: {
    getTasks: vi.fn(),
  },
  isMobileMock: vi.fn(),
  showCalendarClientUpgradeModalMock: vi.fn(),
  createRelatedVisibilityMock: {
    current: undefined as "PUBLIC" | "PRIVATE" | undefined,
  },
}));

const { loadTaskScheduleDialogOptionsMock, scheduleDialogPropsMock } =
  vi.hoisted(() => ({
    loadTaskScheduleDialogOptionsMock: vi.fn(),
    scheduleDialogPropsMock: vi.fn(),
  }));

const { openNewTaskWizardMock, newTaskWizardMock } = vi.hoisted(() => {
  const openNewTaskWizardMock = vi.fn();
  return {
    openNewTaskWizardMock,
    newTaskWizardMock: {
      current: { openNewTaskWizard: openNewTaskWizardMock } as {
        openNewTaskWizard: typeof openNewTaskWizardMock;
      } | null,
    },
  };
});

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => newTaskWizardMock.current,
}));

vi.mock("@/app/tasks/actions", () => ({
  loadTaskScheduleDialogOptions: loadTaskScheduleDialogOptionsMock,
}));

vi.mock("@/app/tasks/components/task-schedule-dialog", () => ({
  TaskScheduleDialog: (props: { onSaved?: (scheduleId: string) => void }) => {
    scheduleDialogPropsMock(props);
    return (
      <div role="dialog" aria-label="schedule dialog">
        <button type="button" onClick={() => props.onSaved?.("schedule-9")}>
          save schedule
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({
    showCalendarClientUpgradeModal: showCalendarClientUpgradeModalMock,
  }),
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
        linkToTask: "Link to task",
        "linkPicker.related.title": "Link as related",
        "linkPicker.related.description":
          "Pick a task. Each task lists the other under Related.",
        createRelated: "Create related",
        removeRelated: "Remove related",
        removeRelatedSuccess: "Related task removed",
        removeRelatedError: "Failed to remove related task",
        taskPickerLoading: "Loading tasks...",
        taskPickerLoadMore: "Load more tasks",
        taskPickerError: "Failed to load tasks",
        taskPickerLoadMoreError: "Failed to load more tasks",
        "relations.related": "Related",
        "relations.blocks": "Blocking",
        "relations.blockedBy": "Blocked by",
        "relations.duplicate": "Duplicate",
        taskPickerSearchPlaceholder: "Search tasks...",
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

vi.mock("@/hooks/effects/use-mobile", () => ({
  useIsMobile: isMobileMock,
}));

vi.mock("@/components/ui/command", () => ({
  CommandDialog: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    title?: string;
    description?: string;
    children: ReactNode;
  }) =>
    open ? (
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    ) : null,
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
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

const archiveMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/task.client", () => ({
  taskClientService: { archive: archiveMock },
}));

vi.mock("@/lib/actions/task/action", () => ({
  revalidateTasksAfterArchive: vi.fn(),
  setTaskStatusFromDrag: vi.fn(),
  moveTaskToWorkspace: vi.fn(),
  createTaskLink: vi.fn(),
  createTaskAndLink: vi.fn(),
  deleteTaskLink: vi.fn(),
}));

const { createSubtaskMock, setTaskParentMock } = vi.hoisted(() => ({
  createSubtaskMock: vi.fn(),
  setTaskParentMock: vi.fn(),
}));
vi.mock("@/lib/actions/task/subtask-action", () => ({
  createSubtask: createSubtaskMock,
  moveSubtask: vi.fn(),
  setTaskParent: setTaskParentMock,
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

const { listChatRoomsMock, sendToChatDialogPropsMock } = vi.hoisted(() => ({
  listChatRoomsMock: vi.fn(),
  sendToChatDialogPropsMock: vi.fn(),
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  listOrganizationChatRoomsAction: listChatRoomsMock,
}));

vi.mock("@/app/tasks/components/task-send-to-chat-dialog", () => ({
  TaskSendToChatDialog: (props: { rooms: { id: string }[] }) => {
    sendToChatDialogPropsMock(props);
    return (
      <div role="dialog" aria-label="send to chat dialog">
        {props.rooms.map((room) => room.id).join(",")}
      </div>
    );
  },
}));

vi.mock("@/app/tasks/components/task-share-button", () => ({
  TaskShareButton: ({ label }: { label: string }) => <button>{label}</button>,
}));

vi.mock("@/app/tasks/components/task-form", () => ({
  TaskForm: ({
    initialValues,
    initialDesignMdAttachment,
    onCreateTask,
    onSuccess,
  }: {
    initialValues?: {
      assigneeId?: string | null;
      assigneeUserId?: string | null;
    };
    initialDesignMdAttachment?: {
      label: string;
      url: string;
      owner: { type: "organization"; name: string; logo: string | null };
    } | null;
    onCreateTask?: (input: {
      description: string;
      assigneeId: string | null;
      assigneeSokoBotId: string | null;
      assigneeUserId?: string | null;
      status: TaskStatus;
      visibility?: "PUBLIC" | "PRIVATE";
      context: {
        brand: {
          enabled: boolean;
          source: "project" | "default" | "custom";
          custom?: { url: string } | null;
        };
        briefingEnabled: boolean;
        contextMdEnabled: boolean;
      };
    }) => Promise<CreateTaskResult>;
    onSuccess?: (task: {
      id: string;
      identifier: string | null;
      name: string;
    }) => void;
  }) => (
    <div>
      <span>{initialValues?.assigneeId ?? "no-coworker"}</span>
      <span>{initialValues?.assigneeUserId ?? "no-user"}</span>
      {initialDesignMdAttachment ? (
        <span data-testid="design-md-picker">
          {initialDesignMdAttachment.label}
        </span>
      ) : null}
      <button
        type="button"
        onClick={async () => {
          if (!onCreateTask) return;
          const result = await onCreateTask({
            description: "Created related task",
            assigneeId: initialValues?.assigneeId ?? null,
            assigneeSokoBotId: null,
            assigneeUserId: initialValues?.assigneeUserId ?? null,
            status: TaskStatus.READY,
            ...(createRelatedVisibilityMock.current
              ? { visibility: createRelatedVisibilityMock.current }
              : {}),
            context: {
              brand: { enabled: true, source: "default", custom: null },
              briefingEnabled: true,
              contextMdEnabled: true,
            },
          });
          if (result.ok) {
            onSuccess?.({
              id: result.value.taskId,
              identifier: result.value.identifier,
              name: result.value.name,
            });
          }
        }}
      >
        Submit related task
      </button>
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function taskStatusSuccess(taskId = "task-1") {
  return { ok: true as const, value: { taskId } };
}

function createTaskAndLinkSuccess(input: {
  taskId: string;
  createdTaskId: string;
  linkId: string;
  name: string;
  identifier?: string | null;
}) {
  return {
    ok: true as const,
    value: { identifier: null, ...input },
  };
}

function buildTaskListItem(
  overrides?: Partial<{
    id: string;
    name: string;
    status: TaskStatus;
    parentTaskId: string | null;
  }>,
) {
  return {
    id: "task-2",
    createdAt: new Date("2026-03-31T10:00:00.000Z"),
    updatedAt: new Date("2026-03-31T10:00:00.000Z"),
    ownerId: "user-1",
    owner: { id: "user-1", name: "Test User", image: null },
    // Deprecated aliases — keep until clients migrate.
    userId: "user-1",
    user: { id: "user-1", name: "Test User", image: null },
    organizationId: null,
    assigneeId: null,
    assigneeSokoBotId: null,
    name: "Alpha task",
    description: null,
    status: TaskStatus.READY,
    credits: 0,
    events: [],
    jobs: [],
    ...overrides,
  };
}

const labels = {
  edit: "Edit",
  archive: "Archive",
  archiveError: "Archive error",
  reopenToReady: "Reopen to Ready",
  reopenToReadyCommentRequired: "A comment is required to reopen this task",
  cancel: "Cancel",
  share: "Share",
  startWorking: "Start working",
  pauseToReady: "Pause to Ready",
  waitExternal: "Wait on external",
  resumeRunning: "Resume running",
  resumeReady: "Back to Ready",
  markComplete: "Mark complete",
};

const actionsMenuLabel = "Actions";

const personalWorkspaceLabel = "Test User";

const sampleOrganizations = [
  { organization: { id: "org-2", name: "Other Org" } },
] as unknown as MemberWithOrganization[];

function organizationMembership(
  role: "admin" | "member" | "owner",
  organization: { id: string; name: string } = {
    id: "org-2",
    name: "Other Org",
  },
): MemberWithOrganization[] {
  return [
    {
      organizationId: "org-1",
      role,
      organization,
    },
  ] as unknown as MemberWithOrganization[];
}

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
      status: TaskStatus.READY,
      archivedAt: null,
      identifier: null,
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
      status: TaskStatus.READY,
      archivedAt: null,
      identifier: null,
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
      status: TaskStatus.DRAFT,
      archivedAt: null,
      identifier: null,
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
      name: "Child task",
      status: TaskStatus.READY,
      archivedAt: null,
      identifier: null,
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
      status: TaskStatus.CANCELED,
      archivedAt: new Date("2024-01-02T00:00:00.000Z"),
      identifier: null,
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

/** The app's query cache; the sub-task checklist reads and writes it. */
let queryClient = new QueryClient();

function renderActionsElement(
  props?: Partial<ComponentProps<typeof TaskDetailActions>>,
) {
  return (
    <QueryClientProvider client={queryClient}>
      <TaskDetailActions
        taskId="task-1"
        share={null}
        status={TaskStatus.READY}
        jobsCount={0}
        taskLinks={[]}
        coworkerOptions={coworkerOptions}
        agentNameById={new Map()}
        defaultAssigneeId="coworker-1"
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        organizations={sampleOrganizations}
        personalWorkspaceLabel={personalWorkspaceLabel}
        isReadOnly={false}
        isTaskOwner
        taskOwnerId="owner-1"
        {...props}
      />
    </QueryClientProvider>
  );
}

/** The header menu next to the related tasks list, as on the task page. */
function renderWithRelatedList(
  props?: Partial<ComponentProps<typeof TaskDetailActions>>,
) {
  return render(
    <TaskDetailLinksProvider>
      {renderActionsElement(props)}
      <TaskRelatedTasks
        tasks={mapVisibleTaskLinks(props?.taskLinks ?? [])}
        relationLabels={
          {
            related: "Related",
            blocks: "Blocking",
          } as ComponentProps<typeof TaskRelatedTasks>["relationLabels"]
        }
        statusLabels={
          {} as ComponentProps<typeof TaskRelatedTasks>["statusLabels"]
        }
      />
    </TaskDetailLinksProvider>,
  );
}

function renderActions(
  props?: Partial<ComponentProps<typeof TaskDetailActions>>,
) {
  return render(renderActionsElement(props));
}

describe("TaskDetailActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
    queryClient = new QueryClient();
    createRelatedVisibilityMock.current = undefined;
    isMobileMock.mockReturnValue(false);
    browserCoreClientMock.getTasks.mockReset();
    vi.mocked(setTaskStatusFromDrag).mockReset();
    vi.mocked(createTaskLink).mockReset();
    vi.mocked(createTaskAndLink).mockReset();
    archiveMock.mockReset().mockResolvedValue(undefined);
    vi.mocked(revalidateTasksAfterArchive).mockReset().mockResolvedValue(true);
    unmarkTaskArchived("task-1");
    vi.mocked(deleteTaskLink).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.CANCELED,
  ] as const)(
    "shows archive in the overflow menu for finalized status %s without edit",
    async (status) => {
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
    },
  );

  it("shows edit and cancel for queued tasks", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.QUEUED,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    const edit = screen.getByRole("link", { name: labels.edit });
    const cancel = screen.getByRole("menuitem", { name: labels.cancel });
    expect(edit).toBeInTheDocument();
    expect(cancel).toBeInTheDocument();

    // Edit above Cancel in the overflow menu
    expect(
      edit.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sets task status to canceled when cancel is chosen for a queued task", async () => {
    const user = userEvent.setup();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockResolvedValueOnce(taskStatusSuccess());

    renderActions({
      status: TaskStatus.QUEUED,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: labels.cancel }));

    await waitFor(() => {
      expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.CANCELED,
      });
    });
  });

  it("shows a menu status change to the rest of the task page at once", async () => {
    const user = userEvent.setup();
    let answer: (result: ReturnType<typeof taskStatusSuccess>) => void =
      () => {};
    vi.mocked(setTaskStatusFromDrag).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    function Panel() {
      const [shown] = useOptimisticTaskStatus(TaskStatus.QUEUED);
      return <p>panel {shown}</p>;
    }
    render(
      <TaskDetailStatusProvider status={TaskStatus.QUEUED}>
        {renderActionsElement({ status: TaskStatus.QUEUED })}
        <Panel />
      </TaskDetailStatusProvider>,
    );

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: labels.cancel }));

    expect(
      screen.getByText(`panel ${TaskStatus.CANCELED}`),
    ).toBeInTheDocument();
    await act(async () => answer(taskStatusSuccess()));
  });

  it("locks the menu while the panel changes the status", async () => {
    let finishWrite: () => void = () => {};
    function Panel() {
      const [, showStatus] = useOptimisticTaskStatus(TaskStatus.RUNNING);
      return (
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              showStatus(TaskStatus.COMPLETED);
              await new Promise<void>((resolve) => (finishWrite = resolve));
            })
          }
        >
          panel write
        </button>
      );
    }
    render(
      <TaskDetailStatusProvider status={TaskStatus.RUNNING}>
        {renderActionsElement({ status: TaskStatus.RUNNING })}
        <Panel />
      </TaskDetailStatusProvider>,
    );

    await act(async () =>
      screen.getByRole("button", { name: "panel write" }).click(),
    );

    expect(
      screen.getByRole("button", { name: actionsMenuLabel }),
    ).toBeDisabled();
    await act(async () => finishWrite());
    expect(
      screen.getByRole("button", { name: actionsMenuLabel }),
    ).toBeEnabled();
  });

  it("hides archive while the coworker is running", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.RUNNING,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(screen.queryByRole("menuitem", { name: labels.archive })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: labels.cancel }),
    ).toBeInTheDocument();
  });

  it("shows cancel while approval is required", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.APPROVAL_REQUIRED,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(screen.queryByRole("menuitem", { name: labels.archive })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: labels.cancel }),
    ).toBeInTheDocument();
  });

  it("shows cancel while awaiting external", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.AWAITING_EXTERNAL,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(screen.queryByRole("menuitem", { name: labels.archive })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: labels.cancel }),
    ).toBeInTheDocument();
  });

  it("sets task status to canceled when cancel is chosen", async () => {
    const user = userEvent.setup();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockResolvedValueOnce(taskStatusSuccess());

    renderActions({
      status: TaskStatus.RUNNING,
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: labels.cancel }));

    await waitFor(() => {
      expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.CANCELED,
      });
    });
  });

  it("shows archive for the task owner while vendor grant approval is pending", async () => {
    const user = userEvent.setup();
    renderActions({
      status: "GRANT_PENDING" as TaskStatus,
      organizations: undefined,
      isTaskOwner: true,
      isReadOnly: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
  });

  it("shows Tasks Activity while archive DELETE is held, blocks a second click, and revalidates once on resolve", async () => {
    const user = userEvent.setup();
    const pendingDelete = Promise.withResolvers<void>();
    const pendingRevalidate = Promise.withResolvers<boolean>();
    archiveMock.mockReturnValueOnce(pendingDelete.promise);
    vi.mocked(revalidateTasksAfterArchive).mockReturnValueOnce(
      pendingRevalidate.promise,
    );

    function TwoRouteHarness() {
      const [route, setRoute] = useState<"/tasks/task-1" | "/tasks">(
        "/tasks/task-1",
      );
      pushMock.mockImplementation((next: string) => {
        if (next === "/tasks") setRoute("/tasks");
      });
      return (
        <>
          <Activity mode={route === "/tasks" ? "visible" : "hidden"}>
            <div data-testid="tasks-route">Tasks board</div>
          </Activity>
          <Activity mode={route === "/tasks/task-1" ? "visible" : "hidden"}>
            {renderActionsElement({
              status: "GRANT_PENDING" as TaskStatus,
              organizations: undefined,
              isTaskOwner: true,
              isReadOnly: true,
            })}
          </Activity>
        </>
      );
    }

    render(<TwoRouteHarness />);
    expect(screen.getByTestId("tasks-route")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: labels.archive }));

    expect(pushMock).toHaveBeenCalledWith("/tasks");
    expect(screen.getByTestId("tasks-route")).toBeVisible();
    expect(archiveMock).toHaveBeenCalledTimes(1);
    expect(archiveMock).toHaveBeenCalledWith("task-1");
    expect(revalidateTasksAfterArchive).not.toHaveBeenCalled();
    expect(isTaskArchived("task-1")).toBe(true);
    expect(isTaskArchivePending("task-1")).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();

    // A second click while DELETE is pending sends no second DELETE.
    const hiddenArchiveButton = screen.getByRole("button", {
      name: labels.archive,
      hidden: true,
    });
    expect(hiddenArchiveButton).toBeDisabled();
    fireEvent.click(hiddenArchiveButton);
    expect(archiveMock).toHaveBeenCalledTimes(1);

    pendingDelete.resolve();
    await waitFor(() =>
      expect(revalidateTasksAfterArchive).toHaveBeenCalledTimes(1),
    );
    expect(isTaskArchivePending("task-1")).toBe(true);

    pendingRevalidate.resolve(true);
    await waitFor(() => expect(isTaskArchivePending("task-1")).toBe(false));
    expect(isTaskArchived("task-1")).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("ignores a second Archive click while still on the task page and re-enables on failure", async () => {
    expectConsole("error", "Failed to archive task");
    const user = userEvent.setup();
    const pendingDelete = Promise.withResolvers<void>();
    archiveMock.mockReturnValueOnce(pendingDelete.promise);
    renderActions({ organizations: undefined });

    const archiveButton = screen.getByRole("button", { name: labels.archive });
    await user.click(archiveButton);

    expect(archiveButton).toBeDisabled();
    fireEvent.click(archiveButton);
    expect(archiveMock).toHaveBeenCalledTimes(1);

    pendingDelete.reject(new Error("nope"));
    await waitFor(() => expect(isTaskArchived("task-1")).toBe(false));
    expect(isTaskArchivePending("task-1")).toBe(false);
    expect(archiveButton).toBeEnabled();
    expect(revalidateTasksAfterArchive).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(labels.archiveError);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows the task again on the board when the archive fails", async () => {
    expectConsole("error", "Failed to archive task");
    const user = userEvent.setup();
    archiveMock.mockRejectedValueOnce(new Error("nope"));
    renderActions({ organizations: undefined });

    await user.click(screen.getByRole("button", { name: labels.archive }));

    expect(pushMock).toHaveBeenCalledWith("/tasks");
    await waitFor(() => expect(isTaskArchived("task-1")).toBe(false));
    expect(revalidateTasksAfterArchive).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(labels.archiveError);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps the task archived and falls back to router.refresh if revalidation fails after DELETE succeeds", async () => {
    expectConsole("error", "Failed to revalidate tasks after archive");
    const user = userEvent.setup();
    vi.mocked(revalidateTasksAfterArchive).mockRejectedValueOnce(
      new Error("skew"),
    );
    renderActions({ organizations: undefined });

    await user.click(screen.getByRole("button", { name: labels.archive }));

    await waitFor(() => expect(isTaskArchivePending("task-1")).toBe(false));
    expect(isTaskArchived("task-1")).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("reports a stale status list instead of opening the upgrade modal", async () => {
    const user = userEvent.setup();
    vi.mocked(setTaskStatusFromDrag).mockResolvedValueOnce({
      ok: false,
      error: { kind: "status_not_selectable" },
    });

    renderActions({
      status: TaskStatus.READY,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
      organizations: undefined,
    });
    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(
      screen.getByRole("menuitem", { name: labels.startWorking }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Errors.updateStatus"),
    );
    expect(showCalendarClientUpgradeModalMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
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

  it("shows cancel only for org collaborators in read-only mode", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.RUNNING,
      isReadOnly: true,
      canCancel: true,
      organizations: undefined,
    });

    expect(
      screen.queryByRole("button", { name: labels.share }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.cancel }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: labels.edit })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: labels.reopenToReady }),
    ).toBeNull();
  });

  it("does not show reopen for org collaborators in read-only mode", () => {
    renderActions({
      status: TaskStatus.CANCELED,
      isReadOnly: true,
      canCancel: true,
      organizations: undefined,
    });

    expect(
      screen.queryByRole("button", { name: actionsMenuLabel }),
    ).not.toBeInTheDocument();
  });

  it("disables the actions trigger while a status update is pending", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<ReturnType<typeof taskStatusSuccess>>();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockReturnValueOnce(deferred.promise);

    renderActions({
      status: TaskStatus.READY,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
      organizations: undefined,
    });

    const actionsButton = screen.getByRole("button", {
      name: actionsMenuLabel,
    });
    await user.click(actionsButton);
    await user.click(
      screen.getByRole("menuitem", { name: labels.startWorking }),
    );

    await waitFor(() => {
      expect(actionsButton).toBeDisabled();
    });

    expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
      taskId: "task-1",
      desiredStatus: TaskStatus.RUNNING,
    });

    deferred.resolve(taskStatusSuccess());

    await waitFor(() => {
      expect(actionsButton).not.toBeDisabled();
    });
  });

  it("runs status actions from the overflow menu", async () => {
    const user = userEvent.setup();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockResolvedValueOnce(taskStatusSuccess());

    renderActions({
      status: TaskStatus.READY,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(
      screen.getByRole("menuitem", { name: labels.startWorking }),
    );

    await waitFor(() => {
      expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.RUNNING,
      });
    });
  });

  it("opens the upgrade modal when a status action is gated", async () => {
    const user = userEvent.setup();
    vi.mocked(setTaskStatusFromDrag).mockResolvedValueOnce({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });

    renderActions({
      status: TaskStatus.READY,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
      organizations: undefined,
    });
    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(
      screen.getByRole("menuitem", { name: labels.startWorking }),
    );

    await waitFor(() => {
      expect(showCalendarClientUpgradeModalMock).toHaveBeenCalledOnce();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("offers reopen-to-ready with a required comment for canceled tasks", async () => {
    const user = userEvent.setup();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockResolvedValueOnce(taskStatusSuccess());

    renderActions({
      status: TaskStatus.CANCELED,
      defaultAssigneeId: "cow-1",
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

    await user.click(
      screen.getByRole("menuitem", { name: labels.reopenToReady }),
    );

    expect(screen.getByRole("heading", { name: "title" })).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", {
      name: "confirm",
    });
    expect(confirmButton).toBeDisabled();

    await user.type(
      screen.getByLabelText("commentLabel"),
      "Please continue from the last draft",
    );
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.READY,
        comment: "Please continue from the last draft",
      });
    });
  });

  it("shows a reopen to the rest of the task page while it is sent", async () => {
    const user = userEvent.setup();
    let answer: (result: ReturnType<typeof taskStatusSuccess>) => void =
      () => {};
    vi.mocked(setTaskStatusFromDrag).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    function Panel() {
      const [shown] = useOptimisticTaskStatus(TaskStatus.CANCELED);
      return <p>panel {shown}</p>;
    }
    render(
      <TaskDetailStatusProvider status={TaskStatus.CANCELED}>
        {renderActionsElement({
          status: TaskStatus.CANCELED,
          defaultAssigneeId: "cow-1",
          organizations: undefined,
        })}
        <Panel />
      </TaskDetailStatusProvider>,
    );

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(
      screen.getByRole("menuitem", { name: labels.reopenToReady }),
    );
    await user.type(screen.getByLabelText("commentLabel"), "Please continue");
    await user.click(screen.getByRole("button", { name: "confirm" }));

    expect(screen.getByText(`panel ${TaskStatus.READY}`)).toBeInTheDocument();
    await act(async () => answer(taskStatusSuccess()));
  });

  it("parks a Coworker's canceled Task as a Draft with no comment", async () => {
    const user = userEvent.setup();
    vi.mocked(setTaskStatusFromDrag).mockResolvedValueOnce(taskStatusSuccess());
    renderActions({
      status: TaskStatus.CANCELED,
      defaultAssigneeId: "cow-1",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(
      screen.getByRole("menuitem", { name: labels.reopenToReady }),
    );
    await user.click(screen.getByRole("button", { name: "reopenAsDraft" }));

    await waitFor(() =>
      expect(setTaskStatusFromDrag).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.DRAFT,
      }),
    );
  });

  it("reopens a person's completed Task to Ready in one click", async () => {
    const user = userEvent.setup();
    vi.mocked(setTaskStatusFromDrag).mockResolvedValueOnce(taskStatusSuccess());
    renderActions({
      status: TaskStatus.COMPLETED,
      defaultAssigneeId: null,
      assigneeKind: "human",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(
      screen.getByRole("menuitem", { name: labels.reopenToReady }),
    );

    expect(screen.queryByRole("heading", { name: "title" })).toBeNull();
    await waitFor(() =>
      expect(setTaskStatusFromDrag).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.READY,
      }),
    );
  });

  it("offers reopen-to-ready for completed tasks", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.COMPLETED,
      defaultAssigneeId: "cow-1",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.reopenToReady }),
    ).toBeInTheDocument();
  });

  it("shows reopen when a canceled task is unset (SOK-868)", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.CANCELED,
      defaultAssigneeId: null,
      assigneeKind: "unset",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.reopenToReady }),
    ).toBeInTheDocument();
  });

  it("offers start working for a human-assigned ready task (SOK-868)", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.READY,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.startWorking }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Revert to Draft" }),
    ).toBeNull();
  });

  it("offers pause, wait, and complete for a human running task (SOK-868)", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.RUNNING,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.markComplete }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: labels.waitExternal }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: labels.pauseToReady }),
    ).toBeInTheDocument();
  });

  it("keeps agent running tasks on cancel-only (SOK-868)", async () => {
    const user = userEvent.setup();
    renderActions({
      status: TaskStatus.RUNNING,
      defaultAssigneeId: "coworker-1",
      assigneeKind: "coworker",
      organizations: undefined,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.queryByRole("menuitem", { name: labels.markComplete }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: labels.cancel }),
    ).toBeInTheDocument();
  });

  it("shows move to workspace when the task can be moved", async () => {
    const user = userEvent.setup();

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    ).toBeInTheDocument();
  });

  it("hides move to workspace from a member who does not own the task", async () => {
    const user = userEvent.setup();

    renderActions({ isTaskOwner: false });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Move to workspace" }),
    ).toBeNull();
  });

  it("hides archive and move on a task without an owner from a plain member", async () => {
    const user = userEvent.setup();

    renderActions({
      taskOwnerId: null,
      isTaskOwner: false,
      currentOrganizationId: "org-1",
      organizations: organizationMembership("member"),
      hasAssignedSeat: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.queryByRole("menuitem", { name: labels.archive }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Move to workspace" }),
    ).not.toBeInTheDocument();
  });

  it("shows archive and move on a task without an owner to an organization admin", async () => {
    const user = userEvent.setup();

    renderActions({
      taskOwnerId: null,
      isTaskOwner: false,
      currentOrganizationId: "org-1",
      organizations: organizationMembership("admin"),
      hasAssignedSeat: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    ).toBeInTheDocument();
  });

  it("hides a personal workspace as a move target for a task without an owner", async () => {
    const user = userEvent.setup();

    renderActions({
      taskOwnerId: null,
      isTaskOwner: false,
      currentOrganizationId: "org-1",
      organizations: organizationMembership("admin", {
        id: "org-1",
        name: "Org",
      }),
      hasPersonalWorkspace: true,
      hasAssignedSeat: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Move to workspace" }),
    ).not.toBeInTheDocument();
  });

  it("shows archive while grant approval is pending to a member of an organization task", async () => {
    const user = userEvent.setup();
    renderActions({
      status: "GRANT_PENDING" as TaskStatus,
      currentOrganizationId: "org-1",
      isTaskOwner: false,
      hasAssignedSeat: true,
      isReadOnly: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: labels.archive }),
    ).toBeInTheDocument();
  });

  it("shows move for an organization task when the user has a personal workspace and no other orgs", async () => {
    const user = userEvent.setup();

    renderActions({
      currentOrganizationId: "org-current",
      organizations: [],
      hasPersonalWorkspace: true,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.getByRole("menuitem", { name: "Move to workspace" }),
    ).toBeInTheDocument();
  });

  it("hides move for an organization task when there is no personal workspace and no other orgs", async () => {
    const user = userEvent.setup();

    renderActions({
      currentOrganizationId: "org-current",
      organizations: [],
      hasPersonalWorkspace: false,
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      screen.queryByRole("menuitem", { name: "Move to workspace" }),
    ).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    await waitFor(() => {
      expect(browserCoreClientMock.getTasks).toHaveBeenCalledWith({
        q: undefined,
        cursor: undefined,
        limit: 20,
      });
    });

    expect(
      await screen.findByRole("heading", { name: "Link as related" }),
    ).toBeVisible();
    expect(
      screen.getByText("Pick a task. Each task lists the other under Related."),
    ).toBeVisible();

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
    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
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
        relation: TaskLinkRelation.RELATED,
      });
    });
  });

  it("closes the picker and lists the linked task before the link answer", async () => {
    expectConsole("error", "Failed to create task link");
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
          status: TaskStatus.DRAFT,
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

    renderWithRelatedList();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);
    await user.click(await screen.findByRole("button", { name: "Alpha task" }));

    await waitFor(() => {
      expect(createTaskLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        relatedTaskId: "task-2",
        relation: TaskLinkRelation.RELATED,
      });
    });
    expect(
      screen.queryByRole("button", { name: "Alpha task" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Related" })).getByRole("link", {
        name: "Alpha task",
      }),
    ).toBeInTheDocument();

    // No link arrived from the server: the write failed, the row goes.
    await act(async () => deferred.reject(new Error("link failed")));
    expect(
      screen.queryByRole("link", { name: "Alpha task" }),
    ).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });

  it("takes a removed link off the list before the answer and puts it back on failure", async () => {
    expectConsole("error", "Failed to remove related task link");
    const user = userEvent.setup();
    const deferred = createDeferred<never>();
    vi.mocked(deleteTaskLink).mockReturnValueOnce(deferred.promise);

    renderWithRelatedList({ taskLinks: [...removableTaskLinks] });
    expect(screen.getByRole("link", { name: "Related task" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Remove related" }));
    await user.click(screen.getByRole("menuitem", { name: "Related task" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "Related task" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Blocked task" })).toBeVisible();

    await act(async () => deferred.reject(new Error("remove failed")));
    expect(screen.getByRole("link", { name: "Related task" })).toBeVisible();
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
    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
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
    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
    await user.click(screen.getAllByRole("menuitem", { name: "Related" })[0]);

    expect(await screen.findByText("Failed to load tasks")).toBeInTheDocument();
  });

  it("opens the create related modal and submits through createTaskAndLink", async () => {
    const user = userEvent.setup();
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createTaskAndLinkMock.mockResolvedValue(
      createTaskAndLinkSuccess({
        taskId: "task-1",
        createdTaskId: "task-created",
        linkId: "link-created",
        name: "Created related task",
      }),
    );

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(await screen.findByRole("menuitem", { name: "Blocking" }));
    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        description: "Created related task",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
        relation: TaskLinkRelation.BLOCKS,
        context: {
          brand: { enabled: true, source: "default", custom: null },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
      });
    });

    expect(pushMock).toHaveBeenCalledWith("/tasks/task-created");
  });

  it("forwards private visibility from create related to createTaskAndLink", async () => {
    const user = userEvent.setup();
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createRelatedVisibilityMock.current = "PRIVATE";
    createTaskAndLinkMock.mockResolvedValue(
      createTaskAndLinkSuccess({
        taskId: "task-1",
        createdTaskId: "task-created",
        linkId: "link-created",
        name: "Created related task",
      }),
    );

    renderActions({ taskVisibility: "PRIVATE" });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(await screen.findByRole("menuitem", { name: "Blocking" }));
    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: "PRIVATE",
        }),
      );
    });
  });

  it("passes the DESIGN.md picker into create-related and forwards skip false", async () => {
    const user = userEvent.setup();
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createTaskAndLinkMock.mockResolvedValue(
      createTaskAndLinkSuccess({
        taskId: "task-1",
        createdTaskId: "task-created",
        linkId: "link-created",
        name: "Created related task",
      }),
    );

    renderActions({
      initialDesignMdAttachment: {
        label: "DESIGN.md",
        url: "https://blob.example/design.md",
        owner: { type: "organization", name: "Acme Inc", logo: null },
      },
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(await screen.findByRole("menuitem", { name: "Blocking" }));

    expect(screen.getByTestId("design-md-picker")).toHaveTextContent(
      "DESIGN.md",
    );

    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        description: "Created related task",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
        relation: TaskLinkRelation.BLOCKS,
        context: {
          brand: { enabled: true, source: "default", custom: null },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
      });
    });
  });

  it("preserves human assignment in create-related (SOK-868)", async () => {
    const user = userEvent.setup();
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createTaskAndLinkMock.mockResolvedValue(
      createTaskAndLinkSuccess({
        taskId: "task-1",
        createdTaskId: "task-created",
        linkId: "link-created",
        name: "Created related task",
      }),
    );

    renderActions({
      status: TaskStatus.READY,
      defaultAssigneeId: "user-1",
      assigneeKind: "human",
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(await screen.findByRole("menuitem", { name: "Blocking" }));

    expect(screen.getByText("user-1")).toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId: null,
          assigneeUserId: "user-1",
        }),
      );
    });
  });

  it("lets a parent link left from before sub-tasks be removed as related", async () => {
    const user = userEvent.setup();

    renderActions({
      taskLinks: [...defaultTaskLinks, ...removableTaskLinks],
    });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: "Remove related" }));
    expect(
      screen.getByRole("menuitem", { name: "Related task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Parent task" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Archived duplicate" }),
    ).not.toBeInTheDocument();
  });

  it("hides remove related when there are no removable links", async () => {
    const user = userEvent.setup();

    renderActions({
      taskLinks: [removableTaskLinks[3]],
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
      expect(toast.success).toHaveBeenCalledWith("Related task removed");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows an error toast when removing a related link fails", async () => {
    expectConsole("error", "Failed to remove related task link");
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
    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    expect(
      document.querySelectorAll('[data-slot="dropdown-menu-separator"]').length,
    ).toBe(3);
  });

  it("archives straight from the overflow menu without confirming", async () => {
    const user = userEvent.setup();
    renderActions({ organizations: undefined });

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    await user.click(screen.getByRole("menuitem", { name: labels.archive }));

    await waitFor(() => {
      expect(archiveMock).toHaveBeenCalledWith("task-1");
      expect(pushMock).toHaveBeenCalledWith("/tasks");
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
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

    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));
    await user.click(screen.getByRole("menuitem", { name: "Related" }));

    await waitFor(() => {
      expect(browserCoreClientMock.getTasks).toHaveBeenCalled();
    });
  });

  it("expands create related inline on mobile and still opens the modal flow", async () => {
    const user = userEvent.setup();
    isMobileMock.mockReturnValue(true);
    const createTaskAndLinkMock = vi.mocked(createTaskAndLink);
    createTaskAndLinkMock.mockResolvedValue(
      createTaskAndLinkSuccess({
        taskId: "task-1",
        createdTaskId: "task-created",
        linkId: "link-created",
        name: "Created related task",
      }),
    );

    renderActions();

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
    expect(screen.queryByRole("menuitem", { name: "Blocking" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Create related" }));
    await user.click(screen.getByRole("menuitem", { name: "Blocking" }));
    await user.click(
      await screen.findByRole("button", { name: "Submit related task" }),
    );

    await waitFor(() => {
      expect(createTaskAndLinkMock).toHaveBeenCalledWith({
        taskId: "task-1",
        description: "Created related task",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
        relation: TaskLinkRelation.BLOCKS,
        context: {
          brand: { enabled: true, source: "default", custom: null },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
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
    await user.click(screen.getByRole("menuitem", { name: "Link to task" }));

    expect(
      screen.getByRole("menuitem", { name: "Related" }),
    ).toBeInTheDocument();

    await user.click(actionsButton);
    await user.click(actionsButton);

    expect(screen.queryByRole("menuitem", { name: "Related" })).toBeNull();
  });

  describe("Repeat", () => {
    const blueprint = {
      name: "Review onboarding",
      description: "Check the new accounts",
      projectId: null,
      visibility: "PUBLIC" as const,
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
    };

    it("opens the Task Schedule dialog prefilled from the Task and leaves the Task alone", async () => {
      const user = userEvent.setup();
      const options = { coworkerOptions, projectOptions: [] };
      loadTaskScheduleDialogOptionsMock.mockResolvedValue(options);
      renderActions({ taskBlueprint: blueprint });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "repeat" }));

      await screen.findByRole("dialog", { name: "schedule dialog" });
      expect(scheduleDialogPropsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          initialBlueprint: blueprint,
          coworkerOptions,
          projectOptions: [],
        }),
      );

      await user.click(screen.getByRole("button", { name: "save schedule" }));

      expect(pushMock).toHaveBeenCalledWith("/schedules/schedule-9");
      // The original Task is neither changed nor linked to the schedule.
      expect(setTaskStatusFromDrag).not.toHaveBeenCalled();
      expect(createTaskLink).not.toHaveBeenCalled();
      expect(createTaskAndLink).not.toHaveBeenCalled();
      expect(archiveMock).not.toHaveBeenCalled();
    });

    it("is not offered where no schedule can be created", async () => {
      const user = userEvent.setup();
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

      expect(screen.queryByRole("menuitem", { name: "repeat" })).toBeNull();
    });
  });

  describe("Duplicate", () => {
    const blueprint = {
      name: "Weekly report",
      description: "Summarise the week",
      projectId: "project-1",
      visibility: "PRIVATE" as const,
      assigneeId: null,
      assigneeSokoBotId: "bot-1",
      assigneeUserId: null,
    };

    afterEach(() => {
      newTaskWizardMock.current = {
        openNewTaskWizard: openNewTaskWizardMock,
      };
    });

    it("opens the New Task form with the brief as a private Draft copy and leaves the Task alone", async () => {
      const user = userEvent.setup();
      renderActions({ taskBlueprint: blueprint });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "duplicate" }));

      expect(openNewTaskWizardMock).toHaveBeenCalledWith({
        prompt: "Summarise the week",
        projectId: "project-1",
        copy: {
          taskId: "task-1",
          name: "Weekly report",
          visibility: "PRIVATE",
          assigneeId: null,
          assigneeSokoBotId: "bot-1",
          assigneeUserId: null,
        },
      });
      expect(setTaskStatusFromDrag).not.toHaveBeenCalled();
      expect(createTaskLink).not.toHaveBeenCalled();
      expect(createTaskAndLink).not.toHaveBeenCalled();
      expect(archiveMock).not.toHaveBeenCalled();
    });

    it("is not offered where the viewer cannot create a Task", async () => {
      const user = userEvent.setup();
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

      expect(screen.queryByRole("menuitem", { name: "duplicate" })).toBeNull();
    });

    it("is not offered outside the app shell's New Task wizard", async () => {
      const user = userEvent.setup();
      newTaskWizardMock.current = null;
      renderActions({ taskBlueprint: blueprint });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

      expect(screen.queryByRole("menuitem", { name: "duplicate" })).toBeNull();
    });
  });

  describe("Send to chat", () => {
    const sendToChat = { currentUserId: "user-1" };
    const chatRoom = (id: string, organizationId: string | null) => ({
      id,
      organizationId,
      kind: "channel",
      isSelfDirect: false,
      isReadOnly: false,
      discoverability: "public",
      userMembers: [],
      coworkerMembers: [],
      sokoBotMembers: [],
    });

    it("opens the dialog with only the Task workspace's rooms", async () => {
      const user = userEvent.setup();
      listChatRoomsMock.mockResolvedValue({
        ok: true,
        value: {
          rooms: [chatRoom("same-org", "org-1"), chatRoom("other", "org-2")],
          nextCursor: null,
        },
      });
      renderActions({ sendToChat, currentOrganizationId: "org-1" });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(
        screen.getByRole("menuitem", { name: "sendToChat.menuItem" }),
      );

      const dialog = await screen.findByRole("dialog", {
        name: "send to chat dialog",
      });
      expect(dialog.textContent).toBe("same-org");
      expect(sendToChatDialogPropsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: "task-1", currentUserId: "user-1" }),
      );
    });

    it("returns focus to the Actions button when the dialog closes", async () => {
      const user = userEvent.setup();
      listChatRoomsMock.mockResolvedValue({
        ok: true,
        value: { rooms: [chatRoom("same-org", "org-1")], nextCursor: null },
      });
      renderActions({ sendToChat, currentOrganizationId: "org-1" });
      const trigger = screen.getByRole("button", { name: actionsMenuLabel });

      await user.click(trigger);
      await user.click(
        screen.getByRole("menuitem", { name: "sendToChat.menuItem" }),
      );
      await screen.findByRole("dialog", { name: "send to chat dialog" });
      trigger.blur();
      const { onCloseAutoFocus } = sendToChatDialogPropsMock.mock.lastCall![0];
      const event = new Event("focusout", { cancelable: true });
      onCloseAutoFocus(event);

      expect(event.defaultPrevented).toBe(true);
      expect(trigger).toHaveFocus();
    });

    it("says so when the rooms cannot be loaded", async () => {
      const user = userEvent.setup();
      listChatRoomsMock.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
      });
      renderActions({ sendToChat, currentOrganizationId: "org-1" });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(
        screen.getByRole("menuitem", { name: "sendToChat.menuItem" }),
      );

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("sendToChat.loadError"),
      );
      expect(
        screen.queryByRole("dialog", { name: "send to chat dialog" }),
      ).toBeNull();
    });

    it("is not offered without it", async () => {
      const user = userEvent.setup();
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

      expect(
        screen.queryByRole("menuitem", { name: "sendToChat.menuItem" }),
      ).toBeNull();
    });
  });
  describe("sub-tasks", () => {
    function listTasks(...tasks: ReturnType<typeof buildTaskListItem>[]) {
      browserCoreClientMock.getTasks.mockResolvedValue({
        data: tasks,
        meta: {
          pagination: {
            cursor: null,
            limit: 20,
            total: tasks.length,
            nextCursor: null,
          },
        },
      });
    }

    beforeEach(() => {
      createSubtaskMock.mockReset();
      setTaskParentMock.mockReset().mockResolvedValue({
        ok: true,
        value: { taskId: "task-1" },
      });
    });

    /** A cached checklist of `parentTaskId`, as the sub-task section leaves it. */
    function cacheSubtasks(parentTaskId: string, ids: string[]) {
      queryClient.setQueryData<SubtaskRow[]>(
        taskSubtasksQueryKey(parentTaskId),
        ids.map((id) => ({
          id,
          identifier: null,
          name: id,
          status: TaskStatus.READY,
          assignee: null,
          dueOn: null,
          subtaskProgress: { completed: 0, total: 0 },
        })),
      );
    }

    function isStale(parentTaskId: string) {
      return queryClient.getQueryState(taskSubtasksQueryKey(parentTaskId))
        ?.isInvalidated;
    }

    it("reads the old and the new parent's checklists again after a move, not this page's", async () => {
      const user = userEvent.setup();
      listTasks(buildTaskListItem({ id: "task-new", name: "New parent" }));
      for (const id of ["task-1", "task-parent", "task-new", "task-other"])
        cacheSubtasks(id, []);
      renderActions({
        parentTaskId: "task-parent",
        ancestorIds: ["task-parent"],
      });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "moveUnder" }));
      await user.click(
        await screen.findByRole("button", { name: "New parent" }),
      );

      await waitFor(() => expect(isStale("task-new")).toBe(true));
      expect(isStale("task-parent")).toBe(true);
      // The action re-renders this page with newer rows.
      expect(isStale("task-1")).toBe(false);
      expect(isStale("task-other")).toBe(false);
    });

    it("reads this page's and a picked Task's old parent's checklists again after Add existing", async () => {
      const user = userEvent.setup();
      listTasks(
        buildTaskListItem({
          id: "task-other",
          name: "Other task",
          parentTaskId: "task-old",
        }),
      );
      for (const id of ["task-1", "task-old"]) cacheSubtasks(id, []);
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "addExisting" }));
      await user.click(
        await screen.findByRole("button", { name: "Other task" }),
      );

      await waitFor(() => expect(isStale("task-old")).toBe(true));
      // This page's list gains the row; its re-render may not replace a
      // cache stamped by the client clock.
      expect(isStale("task-1")).toBe(true);
    });

    it("reads the old parent's checklist again after Remove from parent, not this page's", async () => {
      const user = userEvent.setup();
      for (const id of ["task-1", "task-parent"]) cacheSubtasks(id, []);
      renderActions({ parentTaskId: "task-parent" });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(
        screen.getByRole("menuitem", { name: "removeFromParent" }),
      );

      await waitFor(() => expect(isStale("task-parent")).toBe(true));
      expect(isStale("task-1")).toBe(false);
    });

    it("keeps the picker open while the move runs and closes it on success", async () => {
      const user = userEvent.setup();
      const answer = Promise.withResolvers<{
        ok: true;
        value: { taskId: string };
      }>();
      setTaskParentMock.mockReturnValue(answer.promise);
      listTasks(buildTaskListItem({ id: "task-new", name: "New parent" }));
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "moveUnder" }));
      await user.click(
        await screen.findByRole("button", { name: "New parent" }),
      );

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "New parent" }),
        ).toBeDisabled(),
      );
      await act(async () =>
        answer.resolve({ ok: true, value: { taskId: "task-1" } }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "New parent" })).toBeNull(),
      );
    });

    it("opens the picker with an empty search after a pick", async () => {
      const user = userEvent.setup();
      listTasks(buildTaskListItem({ id: "task-other", name: "Other task" }));
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "addExisting" }));
      await user.type(
        screen.getByRole("textbox", { name: "Search tasks..." }),
        "Oth",
      );
      await user.click(
        await screen.findByRole("button", { name: "Other task" }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("textbox", { name: "Search tasks..." }),
        ).toBeNull(),
      );
      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "addExisting" }));

      expect(
        screen.getByRole("textbox", { name: "Search tasks..." }),
      ).toHaveValue("");
    });

    it("does not offer this Task's own sub-tasks to Add existing or Move under", async () => {
      const user = userEvent.setup();
      cacheSubtasks("task-1", ["task-child"]);
      listTasks(
        buildTaskListItem({ id: "task-child", name: "Its child" }),
        buildTaskListItem({ id: "task-other", name: "Other task" }),
      );

      for (const item of ["addExisting", "moveUnder"]) {
        const { unmount } = renderActions();
        await user.click(
          screen.getByRole("button", { name: actionsMenuLabel }),
        );
        await user.click(screen.getByRole("menuitem", { name: item }));
        await screen.findByRole("button", { name: "Other task" });

        expect(screen.queryByRole("button", { name: "Its child" })).toBeNull();
        unmount();
      }
    });

    it("offers no new sub-task once the checklist is past its first page", async () => {
      const user = userEvent.setup();
      cacheSubtasks(
        "task-1",
        Array.from({ length: SUBTASK_LIST_LIMIT }, (_, index) => `t${index}`),
      );
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

      expect(screen.queryByRole("menuitem", { name: "add" })).toBeNull();
      expect(
        screen.getByRole("menuitem", { name: "addExisting" }),
      ).toBeInTheDocument();
    });

    it("adds a picked Task as a sub-task and does not offer an ancestor", async () => {
      const user = userEvent.setup();
      listTasks(
        buildTaskListItem({ id: "task-root", name: "Root task" }),
        buildTaskListItem({ id: "task-other", name: "Other task" }),
      );
      renderActions({ parentTaskId: "task-root", ancestorIds: ["task-root"] });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "addExisting" }));
      const other = await screen.findByRole("button", { name: "Other task" });

      expect(browserCoreClientMock.getTasks).toHaveBeenCalledWith(
        expect.objectContaining({ includeSubtasks: "true" }),
      );
      expect(screen.queryByRole("button", { name: "Root task" })).toBeNull();
      await user.click(other);
      await waitFor(() =>
        expect(setTaskParentMock).toHaveBeenCalledWith({
          taskId: "task-other",
          parentTaskId: "task-1",
        }),
      );
    });

    it("moves the Task under a picked Task and does not offer its own parent", async () => {
      const user = userEvent.setup();
      listTasks(
        buildTaskListItem({ id: "task-parent", name: "Current parent" }),
        buildTaskListItem({ id: "task-new", name: "New parent" }),
      );
      renderActions({
        parentTaskId: "task-parent",
        ancestorIds: ["task-parent"],
      });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "moveUnder" }));
      const newParent = await screen.findByRole("button", {
        name: "New parent",
      });

      expect(
        screen.queryByRole("button", { name: "Current parent" }),
      ).toBeNull();
      await user.click(newParent);
      await waitFor(() =>
        expect(setTaskParentMock).toHaveBeenCalledWith({
          taskId: "task-1",
          parentTaskId: "task-new",
        }),
      );
    });

    it("shows Core's refusal of a move", async () => {
      const user = userEvent.setup();
      listTasks(buildTaskListItem({ id: "task-child", name: "Its child" }));
      setTaskParentMock.mockResolvedValue({
        ok: false,
        error: { code: "UNPROCESSABLE", message: "That would be a cycle." },
      });
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "moveUnder" }));
      await user.click(
        await screen.findByRole("button", { name: "Its child" }),
      );

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("moveError", {
          description: "That would be a cycle.",
        }),
      );
      // The picker stays open for another pick.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Its child" })).toBeEnabled(),
      );
    });

    it("shows Try again later, not the raw text, on the move toast for a failure that is not Core's refusal", async () => {
      const user = userEvent.setup();
      listTasks(buildTaskListItem({ id: "task-new", name: "New parent" }));
      setTaskParentMock.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "fetch failed" },
      });
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "moveUnder" }));
      await user.click(
        await screen.findByRole("button", { name: "New parent" }),
      );

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("moveError", {
          description: "serverErrorDescription",
        }),
      );
    });

    it("removes a sub-task from its parent, and offers that only to a sub-task", async () => {
      const user = userEvent.setup();
      const { unmount } = renderActions();
      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      expect(
        screen.queryByRole("menuitem", { name: "removeFromParent" }),
      ).toBeNull();
      unmount();

      renderActions({ parentTaskId: "task-parent" });
      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(
        screen.getByRole("menuitem", { name: "removeFromParent" }),
      );

      await waitFor(() =>
        expect(setTaskParentMock).toHaveBeenCalledWith({
          taskId: "task-1",
          parentTaskId: null,
        }),
      );
    });

    it("creates a sub-task from the dialog", async () => {
      const user = userEvent.setup();
      createSubtaskMock.mockResolvedValue({ ok: true, value: {} });
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "add" }));
      await user.type(
        screen.getByRole("textbox", { name: "name" }),
        "Draft it",
      );
      await user.click(screen.getByRole("button", { name: "create" }));

      await waitFor(() =>
        expect(createSubtaskMock).toHaveBeenCalledWith({
          parentTaskId: "task-1",
          name: "Draft it",
          description: null,
          assigneeId: null,
          assigneeSokoBotId: null,
          assigneeUserId: null,
          dueOn: null,
        }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("textbox", { name: "name" })).toBeNull(),
      );
    });

    it("keeps the draft when Core refuses a new sub-task", async () => {
      const user = userEvent.setup();
      createSubtaskMock.mockResolvedValue({
        ok: false,
        error: { code: "UNPROCESSABLE", message: "Too deep." },
      });
      renderActions();

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));
      await user.click(screen.getByRole("menuitem", { name: "add" }));
      await user.type(
        screen.getByRole("textbox", { name: "name" }),
        "Draft it",
      );
      await user.click(screen.getByRole("button", { name: "create" }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("createError", {
          description: "Too deep.",
        }),
      );
      expect(screen.getByRole("textbox", { name: "name" })).toHaveValue(
        "Draft it",
      );
    });

    it("reads the checklist again and returns focus to the menu after a new sub-task", async () => {
      const user = userEvent.setup();
      createSubtaskMock.mockResolvedValue({ ok: true, value: {} });
      cacheSubtasks("task-1", []);
      renderActions();
      const trigger = screen.getByRole("button", { name: actionsMenuLabel });

      await user.click(trigger);
      await user.click(screen.getByRole("menuitem", { name: "add" }));
      await user.type(screen.getByRole("textbox", { name: "name" }), "Do it");
      await user.click(screen.getByRole("button", { name: "create" }));

      await waitFor(() =>
        expect(screen.queryByRole("textbox", { name: "name" })).toBeNull(),
      );
      // No toggle is in flight, so the read cannot undo one.
      expect(isStale("task-1")).toBe(true);
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("offers no new sub-task at the deepest level", async () => {
      const user = userEvent.setup();
      const ancestorIds = Array.from(
        { length: MAX_SUBTASK_DEPTH },
        (_, level) => `task-level-${level}`,
      );
      renderActions({ parentTaskId: ancestorIds.at(-1), ancestorIds });

      await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

      expect(screen.queryByRole("menuitem", { name: "add" })).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "addExisting" }),
      ).toBeNull();
      expect(
        screen.getByRole("menuitem", { name: "moveUnder" }),
      ).toBeInTheDocument();
    });
  });
});
