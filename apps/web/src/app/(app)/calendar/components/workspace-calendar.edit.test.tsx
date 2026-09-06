import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ComponentProps, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

interface FullCalendarProps {
  dateClick?: (info: { date: Date }) => void;
  editable?: boolean;
  eventContent?: (info: { event: { id: string; title: string } }) => ReactNode;
  events?: Array<{ id: string; title: string }>;
  plugins?: unknown[];
}

const {
  alertDialogActionMock,
  alertDialogMock,
  clearTaskScheduleMock,
  filterDropdownMenuMock,
  fullCalendarMock,
  getProjectCalendarMock,
  getTaskByIdMock,
  getWorkspaceCalendarMock,
  interactionPluginMock,
  metadataToSelectionMock,
  openCreateTaskModalMock,
  pushMock,
  refreshMock,
  saveCalendarTaskScheduleMock,
  taskScheduleSectionMock,
} = vi.hoisted(() => ({
  alertDialogActionMock: vi.fn(),
  alertDialogMock: vi.fn(),
  clearTaskScheduleMock: vi.fn(),
  filterDropdownMenuMock: vi.fn(),
  fullCalendarMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getTaskByIdMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
  interactionPluginMock: {},
  metadataToSelectionMock: vi.fn(),
  openCreateTaskModalMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  saveCalendarTaskScheduleMock: vi.fn(),
  taskScheduleSectionMock: vi.fn(),
}));

vi.mock("@fullcalendar/react", () => ({
  default: (props: FullCalendarProps) => {
    fullCalendarMock(props);
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            props.dateClick?.({ date: new Date("2030-01-02T09:00:00.000Z") })
          }
        >
          empty calendar slot
        </button>
        {props.events?.map((event) => (
          <div key={event.id}>
            {props.eventContent?.({ event }) ?? event.title}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/interaction", () => ({
  default: interactionPluginMock,
}));
vi.mock("@fullcalendar/react/list", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/classic", () => ({ default: {} }));
vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(value),
  }),
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === "event.accessibleName" ? `${values?.task}, ${values?.source}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({
    handleOpenWithDefaults: openCreateTaskModalMock,
  }),
}));

vi.mock("@/components/ui/alert-dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/alert-dialog")>();

  return {
    ...actual,
    AlertDialog: (props: ComponentProps<typeof actual.AlertDialog>) => {
      alertDialogMock(props);
      return <actual.AlertDialog {...props} />;
    },
    AlertDialogAction: (
      props: ComponentProps<typeof actual.AlertDialogAction>,
    ) => {
      alertDialogActionMock(props);
      return <actual.AlertDialogAction {...props} />;
    },
  };
});

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="calendar-filters" />;
  },
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: ComponentProps<"span">) => (
    <span {...props}>{children}</span>
  ),
  AvatarFallback: ({ children, ...props }: ComponentProps<"span">) => (
    <span {...props}>{children}</span>
  ),
  AvatarImage: (props: ComponentProps<"img">) => <img {...props} />,
}));

vi.mock("@/components/task-schedule-section", () => ({
  TaskScheduleSection: ({
    canClearSchedule,
    initialSelection,
    onClearSchedule,
    onSave,
  }: {
    canClearSchedule?: boolean;
    initialSelection?: TaskScheduleSelection;
    onClearSchedule?: () => void;
    onSave?: (selection: TaskScheduleSelection) => void;
  }) => {
    taskScheduleSectionMock({
      canClearSchedule,
      initialSelection,
      onClearSchedule,
      onSave,
    });
    return (
      <div>
        {canClearSchedule ? (
          <button type="button" onClick={onClearSchedule}>
            clear schedule
          </button>
        ) : null}
        <button
          type="button"
          onClick={() =>
            onSave?.({
              mode: "once",
              oneTimeLocalIso: "2030-01-02T09:00",
              timezone: "UTC",
            })
          }
        >
          save schedule
        </button>
      </div>
    );
  },
}));

vi.mock("@/lib/actions/task/action", () => ({
  clearTaskSchedule: clearTaskScheduleMock,
  saveCalendarTaskSchedule: saveCalendarTaskScheduleMock,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: getProjectCalendarMock,
    getTaskById: getTaskByIdMock,
    getWorkspaceCalendar: getWorkspaceCalendarMock,
  },
}));

vi.mock("@/lib/utils/task-schedule", () => ({
  metadataToSelection: metadataToSelectionMock,
}));

import { WorkspaceCalendar } from "./workspace-calendar";

const ITEM: WorkspaceCalendarItem = {
  id: "occurrence-1",
  taskId: "task-1",
  canEditSchedule: true,
  taskName: "Prepare release notes",
  taskStatus: "QUEUED",
  taskAssigneeId: "coworker-1",
  scheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  originalScheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  state: "PLANNED",
  sourceId: "project:project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
  sourceProjectId: "project-1",
  sourceAccuracy: "EXACT",
  timeAccuracy: "EXACT",
};

const SECOND_ITEM: WorkspaceCalendarItem = {
  ...ITEM,
  id: "occurrence-2",
  taskId: "task-2",
  taskName: "Publish release notes",
};

const READ_ONLY_ITEM: WorkspaceCalendarItem = {
  ...ITEM,
  canEditSchedule: false,
};

const RELEASED_ITEM: WorkspaceCalendarItem = {
  ...READ_ONLY_ITEM,
  id: "occurrence-released-1",
  state: "RELEASED",
};

const SOURCES: WorkspaceCalendarSource[] = [
  {
    sourceId: "workspace:workspace-1",
    sourceType: "WORKSPACE",
    displayName: "Ada's workspace",
    logoUrl: null,
    paletteToken: "blue",
    isSchedulable: true,
  },
  {
    sourceId: "project:project-1",
    sourceType: "PROJECT",
    displayName: "Release planning",
    logoUrl: null,
    paletteToken: "violet",
    isSchedulable: true,
  },
];

const CALENDAR_PAGE = {
  pagination: {
    limit: 100,
    nextCursor: "cursor-2",
  },
  range: {
    from: new Date("2030-01-01T00:00:00.000Z"),
    to: new Date("2030-02-01T00:00:00.000Z"),
  },
};

function renderCalendar(
  props: Partial<ComponentProps<typeof WorkspaceCalendar>> = {},
) {
  return render(
    <NuqsTestingAdapter searchParams="?timezone=UTC">
      <WorkspaceCalendar
        initialDate="2030-01-02"
        items={[ITEM]}
        sources={SOURCES}
        coworkers={[{ id: "coworker-1", name: "Ada" }]}
        {...props}
      />
    </NuqsTestingAdapter>,
  );
}

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function getClearConfirmationHandlers() {
  const submit = (
    alertDialogActionMock.mock.calls.at(-1)?.[0] as
      | { onClick?: (event: { preventDefault: () => void }) => void }
      | undefined
  )?.onClick;
  const dismiss = (
    alertDialogMock.mock.calls.at(-1)?.[0] as
      | { onOpenChange?: (open: boolean) => void }
      | undefined
  )?.onOpenChange;
  if (!submit || !dismiss) {
    throw new Error("Expected clear confirmation handlers");
  }

  const event = { preventDefault: vi.fn() };
  return { dismiss, event, submit };
}

async function openEditor(
  user: ReturnType<typeof userEvent.setup>,
  item: WorkspaceCalendarItem = ITEM,
) {
  await user.click(
    screen.getAllByRole("button", {
      name: `${item.taskName}, Release planning`,
    })[0],
  );
  await user.click(
    screen.getByRole("menuitem", { name: "event.editSchedule" }),
  );
  await screen.findByRole("dialog");
}

async function openClearConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "clear schedule" }));
  return screen.getByRole("alertdialog");
}

describe("WorkspaceCalendar editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveCalendarTaskScheduleMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
    clearTaskScheduleMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
    metadataToSelectionMock.mockReturnValue({
      mode: "recurring",
      cron: "0 9 * * *",
      timezone: "UTC",
    });
    getTaskByIdMock.mockResolvedValue({
      data: { id: "task-1", metadata: '{"version":2}' },
    });
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    getProjectCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
  });

  it("configures FullCalendar date clicks with the interaction plugin", () => {
    renderCalendar();

    const props = fullCalendarMock.mock.calls[0]?.[0] as FullCalendarProps;
    expect(props.dateClick).toEqual(expect.any(Function));
    expect(props.editable).toBe(false);
    expect(props.plugins).toContain(interactionPluginMock);
  });

  it("shows a source filter only on the top-level Calendar and includes Projects in pagination", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&projectId=project-1">
        <WorkspaceCalendar
          initialDate="2030-01-02"
          items={[ITEM]}
          sources={SOURCES}
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );

    const topLevelSections = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{ id: string }>;
    };
    expect(topLevelSections.sections.map((section) => section.id)).toContain(
      "source",
    );

    await user.click(
      screen.getByRole("button", { name: "pagination.loadMore" }),
    );
    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );

    renderCalendar({
      ...CALENDAR_PAGE,
      lockedProjectId: "project-1",
    });
    const projectSections = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{ id: string }>;
    };
    expect(projectSections.sections.map((section) => section.id)).not.toContain(
      "source",
    );
  });

  it("keeps the Project Calendar locked when a projectId is present in the URL", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&projectId=project-2">
        <WorkspaceCalendar
          initialDate="2030-01-02"
          items={[ITEM]}
          lockedProjectId="project-1"
          sources={SOURCES}
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );

    const sections = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{ id: string }>;
    };
    expect(sections.sections.map((section) => section.id)).not.toContain(
      "source",
    );

    await user.click(
      screen.getByRole("button", { name: "pagination.loadMore" }),
    );
    expect(getProjectCalendarMock).toHaveBeenCalledWith(
      "project-1",
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
  });

  it("opens the shared task modal with a locked Project and clicked schedule", async () => {
    const user = userEvent.setup();
    renderCalendar({ lockedProjectId: "project-1" });

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );

    expect(openCreateTaskModalMock).toHaveBeenCalledWith({
      projectId: "project-1",
      schedule: {
        mode: "once",
        oneTimeLocalIso: "2030-01-02T09:00",
        timezone: "UTC",
      },
    });
  });

  it("opens calendar scheduling for the visible calendar date", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=Pacific%2FKiritimati&view=agenda">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2030-01-02"
          items={[ITEM]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    const createButton = screen.getByRole("button", {
      name: "create.title",
    });

    await user.click(createButton);

    expect(openCreateTaskModalMock).toHaveBeenCalledWith({
      projectId: null,
      schedule: {
        mode: "once",
        oneTimeLocalIso: "2030-01-02T12:00",
        timezone: "Pacific/Kiritimati",
      },
    });
  });

  it("prefills the active Project source on the workspace Calendar", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&projectId=project-1">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2030-01-02"
          items={[ITEM]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );

    expect(openCreateTaskModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
  });

  it("hides mobile Agenda scheduling when no source can accept a task", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&view=agenda">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2030-01-02"
          items={[ITEM]}
          sources={SOURCES.map((source) => ({
            ...source,
            isSchedulable: false,
          }))}
        />
      </NuqsTestingAdapter>,
    );

    expect(
      screen.queryByRole("button", { name: "create.title" }),
    ).not.toBeInTheDocument();
  });

  it("does not open task creation from an unschedulable calendar slot", async () => {
    const user = userEvent.setup();
    renderCalendar({
      sources: SOURCES.map((source) => ({
        ...source,
        isSchedulable: false,
      })),
    });

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );

    expect(openCreateTaskModalMock).not.toHaveBeenCalled();
  });

  it("does not open locked Project creation when its source is unschedulable", async () => {
    const user = userEvent.setup();
    renderCalendar({
      lockedProjectId: "project-1",
      sources: SOURCES.map((source) =>
        source.sourceId === "project:project-1"
          ? { ...source, isSchedulable: false }
          : source,
      ),
    });

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );

    expect(openCreateTaskModalMock).not.toHaveBeenCalled();
  });

  it("opens an existing event editor and saves its schedule", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await openEditor(user);
    expect(await screen.findByRole("dialog")).toHaveTextContent("edit.title");
    expect(getTaskByIdMock).toHaveBeenCalledWith("task-1");
    expect(metadataToSelectionMock).toHaveBeenCalledWith(
      '{"version":2}',
      expect.any(String),
    );

    await user.click(screen.getByRole("button", { name: "save schedule" }));
    await waitFor(() =>
      expect(saveCalendarTaskScheduleMock).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" }),
      ),
    );
  });

  it("preserves the schedule when removal is canceled", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await openEditor(user);
    await openClearConfirmation(user);
    await user.click(screen.getByRole("button", { name: "edit.clearCancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(clearTaskScheduleMock).not.toHaveBeenCalled();
  });

  it("submits a rapid duplicate removal only once", async () => {
    const user = userEvent.setup();
    const request = createDeferred<{
      ok: true;
      value: { taskId: string };
    }>();
    clearTaskScheduleMock.mockReturnValue(request.promise);
    renderCalendar();

    await openEditor(user);
    await openClearConfirmation(user);
    const { event, submit } = getClearConfirmationHandlers();
    act(() => {
      submit(event);
      submit(event);
    });

    expect(clearTaskScheduleMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => {
      request.resolve({ ok: true, value: { taskId: ITEM.taskId } });
      await request.promise;
    });
  });

  it("rejects confirmation dismissal while removal is pending", async () => {
    const user = userEvent.setup();
    const request = createDeferred<{
      ok: true;
      value: { taskId: string };
    }>();
    clearTaskScheduleMock.mockReturnValue(request.promise);
    renderCalendar();

    await openEditor(user);
    await openClearConfirmation(user);
    const { dismiss, event, submit } = getClearConfirmationHandlers();
    act(() => {
      submit(event);
      dismiss(false);
    });

    expect(
      screen.getByRole("button", { name: "edit.clearConfirm" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "edit.clearCancel" }),
    ).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => {
      request.resolve({ ok: true, value: { taskId: ITEM.taskId } });
      await request.promise;
    });
  });

  it("does not let a stale removal completion close a newer editor", async () => {
    const user = userEvent.setup();
    const request = createDeferred<{
      ok: true;
      value: { taskId: string };
    }>();
    clearTaskScheduleMock.mockReturnValue(request.promise);
    getTaskByIdMock.mockImplementation((taskId: string) =>
      Promise.resolve({
        data: {
          id: taskId,
          metadata:
            taskId === SECOND_ITEM.taskId
              ? '{"task":"second"}'
              : '{"task":"first"}',
        },
      }),
    );
    renderCalendar({ items: [ITEM, SECOND_ITEM] });

    await openEditor(user);
    await openClearConfirmation(user);
    fireEvent.click(screen.getByRole("button", { name: "edit.clearConfirm" }));

    const calendarProps = fullCalendarMock.mock.calls[0]?.[0] as
      | FullCalendarProps
      | undefined;
    const secondEvent = calendarProps?.eventContent?.({
      event: { id: SECOND_ITEM.id, title: SECOND_ITEM.taskName },
    });
    if (
      !isValidElement<{
        onEditSchedule: (taskId: string) => void;
      }>(secondEvent)
    ) {
      throw new Error("Expected the second calendar event to be editable");
    }
    await act(async () => {
      secondEvent.props.onEditSchedule(SECOND_ITEM.taskId);
    });
    await waitFor(() =>
      expect(metadataToSelectionMock).toHaveBeenCalledWith(
        '{"task":"second"}',
        expect.any(String),
      ),
    );

    await act(async () => {
      request.resolve({ ok: true, value: { taskId: ITEM.taskId } });
      await request.promise;
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the editor after an immediate removal success", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await openEditor(user);
    await openClearConfirmation(user);
    await user.click(screen.getByRole("button", { name: "edit.clearConfirm" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(clearTaskScheduleMock).toHaveBeenCalledWith({ taskId: ITEM.taskId });
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("keeps a removal failure in the confirmation and allows retry", async () => {
    const user = userEvent.setup();
    clearTaskScheduleMock
      .mockResolvedValueOnce({ ok: false, error: { kind: "unexpected" } })
      .mockResolvedValueOnce({
        ok: true,
        value: { taskId: ITEM.taskId },
      });
    renderCalendar();

    await openEditor(user);
    await openClearConfirmation(user);
    await user.click(screen.getByRole("button", { name: "edit.clearConfirm" }));

    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByRole("alert")).toHaveTextContent(
      "edit.clearError",
    );
    expect(
      within(confirmation).getByRole("button", {
        name: "edit.clearConfirm",
      }),
    ).toBeEnabled();
    expect(
      within(confirmation).getByRole("button", { name: "edit.clearCancel" }),
    ).toBeEnabled();

    await user.click(
      within(confirmation).getByRole("button", {
        name: "edit.clearConfirm",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    expect(clearTaskScheduleMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("keeps a rejected removal in the confirmation and allows retry", async () => {
    const user = userEvent.setup();
    clearTaskScheduleMock
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce({
        ok: true,
        value: { taskId: ITEM.taskId },
      });
    renderCalendar();

    await openEditor(user);
    await openClearConfirmation(user);
    await user.click(screen.getByRole("button", { name: "edit.clearConfirm" }));

    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByRole("alert")).toHaveTextContent(
      "edit.clearError",
    );
    expect(
      within(confirmation).getByRole("button", {
        name: "edit.clearConfirm",
      }),
    ).toBeEnabled();
    expect(
      within(confirmation).getByRole("button", { name: "edit.clearCancel" }),
    ).toBeEnabled();

    await user.click(
      within(confirmation).getByRole("button", {
        name: "edit.clearConfirm",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    expect(clearTaskScheduleMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("opens a released event in its read-only task detail", async () => {
    const user = userEvent.setup();
    renderCalendar({ items: [RELEASED_ITEM] });

    await user.click(
      screen.getAllByRole("button", {
        name: "Prepare release notes, Release planning",
      })[0],
    );
    await user.click(screen.getByRole("menuitem", { name: "event.openTask" }));

    expect(pushMock).toHaveBeenCalledWith(`/tasks/${RELEASED_ITEM.taskId}`);
    expect(getTaskByIdMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the newest event selection when an earlier event fetch resolves last", async () => {
    const user = userEvent.setup();
    const firstRequest = createDeferred<{
      data: { id: string; metadata: string };
    }>();
    const secondRequest = createDeferred<{
      data: { id: string; metadata: string };
    }>();
    getTaskByIdMock.mockImplementation((taskId: string) =>
      taskId === ITEM.taskId ? firstRequest.promise : secondRequest.promise,
    );
    renderCalendar({ items: [ITEM, SECOND_ITEM] });

    await user.click(
      screen.getAllByRole("button", {
        name: "Prepare release notes, Release planning",
      })[0],
    );
    await user.click(
      screen.getByRole("menuitem", { name: "event.editSchedule" }),
    );
    await user.click(
      screen.getAllByRole("button", {
        name: "Publish release notes, Release planning",
      })[0],
    );
    await user.click(
      screen.getByRole("menuitem", { name: "event.editSchedule" }),
    );

    await act(async () => {
      secondRequest.resolve({
        data: { id: SECOND_ITEM.taskId, metadata: '{"task":"second"}' },
      });
      await secondRequest.promise;
    });
    expect(metadataToSelectionMock).toHaveBeenCalledWith(
      '{"task":"second"}',
      expect.any(String),
    );

    await act(async () => {
      firstRequest.resolve({
        data: { id: ITEM.taskId, metadata: '{"task":"first"}' },
      });
      await firstRequest.promise;
    });

    expect(metadataToSelectionMock).toHaveBeenCalledTimes(1);
  });
});
