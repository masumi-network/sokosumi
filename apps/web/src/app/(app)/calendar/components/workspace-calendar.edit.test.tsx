import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

interface FullCalendarProps {
  dateClick?: (info: { date: Date }) => void;
  editable?: boolean;
  eventClick?: (info: { event: { id: string } }) => void;
  events?: Array<{ id: string; title: string }>;
  plugins?: unknown[];
}

const {
  clearTaskScheduleMock,
  createScheduledTaskMock,
  filterDropdownMenuMock,
  fullCalendarMock,
  getProjectCalendarMock,
  getTaskByIdMock,
  getWorkspaceCalendarMock,
  interactionPluginMock,
  metadataToSelectionMock,
  pushMock,
  refreshMock,
  saveTaskScheduleMock,
  taskScheduleSectionMock,
} = vi.hoisted(() => ({
  clearTaskScheduleMock: vi.fn(),
  createScheduledTaskMock: vi.fn(),
  filterDropdownMenuMock: vi.fn(),
  fullCalendarMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getTaskByIdMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
  interactionPluginMock: {},
  metadataToSelectionMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  saveTaskScheduleMock: vi.fn(),
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
          <button
            key={event.id}
            type="button"
            onClick={() => props.eventClick?.({ event: { id: event.id } })}
          >
            {event.title}
          </button>
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
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="calendar-filters" />;
  },
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
  createScheduledTask: createScheduledTaskMock,
  saveTaskSchedule: saveTaskScheduleMock,
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

describe("WorkspaceCalendar editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createScheduledTaskMock.mockResolvedValue({
      ok: true,
      value: { name: "Prepare release notes", taskId: "task-1" },
    });
    saveTaskScheduleMock.mockResolvedValue({
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

  it("creates a locked Project task with a stable operation ID after a date click retry", async () => {
    const user = userEvent.setup();
    createScheduledTaskMock
      .mockRejectedValueOnce(new Error("Create failed"))
      .mockResolvedValueOnce({
        ok: true,
        value: { name: "Prepare release notes", taskId: "task-1" },
      });
    renderCalendar({ lockedProjectId: "project-1" });

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("create.title");
    expect(screen.queryByLabelText("create.source")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("create.name"), "New release");
    await user.click(screen.getByRole("button", { name: "save schedule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("create.error");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "save schedule" }));
    await waitFor(() =>
      expect(createScheduledTaskMock).toHaveBeenCalledTimes(2),
    );

    expect(createScheduledTaskMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        assigneeId: "coworker-1",
        name: "New release",
        source: { projectId: "project-1", type: "project" },
      }),
    );
    expect(createScheduledTaskMock.mock.calls[0]?.[0].operationId).toBe(
      createScheduledTaskMock.mock.calls[1]?.[0].operationId,
    );
    expect(createScheduledTaskMock.mock.calls[0]?.[0].operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(refreshMock).toHaveBeenCalledOnce();
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

    expect(screen.getByRole("dialog")).toHaveTextContent("create.title");
    expect(taskScheduleSectionMock.mock.calls.at(-1)?.[0]).toMatchObject({
      initialSelection: {
        mode: "once",
        oneTimeLocalIso: "2030-01-02T12:00",
        timezone: "Pacific/Kiritimati",
      },
    });
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

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not offer unschedulable sources when creating a task", async () => {
    const user = userEvent.setup();
    renderCalendar({
      sources: SOURCES.map((source) =>
        source.sourceId === "project:project-1"
          ? { ...source, isSchedulable: false }
          : source,
      ),
    });

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );
    await user.click(screen.getByLabelText("create.source"));

    expect(
      screen.queryByRole("option", { name: "Release planning" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Ada's workspace" }),
    ).toBeInTheDocument();
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

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createScheduledTaskMock).not.toHaveBeenCalled();
  });

  it("opens an existing event editor and saves or clears its schedule", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await user.click(screen.getAllByRole("button", { name: ITEM.taskName })[0]);
    expect(await screen.findByRole("dialog")).toHaveTextContent("edit.title");
    expect(getTaskByIdMock).toHaveBeenCalledWith("task-1");
    expect(metadataToSelectionMock).toHaveBeenCalledWith(
      '{"version":2}',
      expect.any(String),
    );

    await user.click(screen.getByRole("button", { name: "save schedule" }));
    await waitFor(() =>
      expect(saveTaskScheduleMock).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" }),
      ),
    );

    await user.click(screen.getAllByRole("button", { name: ITEM.taskName })[0]);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "clear schedule" }));
    await waitFor(() =>
      expect(clearTaskScheduleMock).toHaveBeenCalledWith({ taskId: "task-1" }),
    );
  });

  it("opens a released event in its read-only task detail", async () => {
    const user = userEvent.setup();
    renderCalendar({ items: [RELEASED_ITEM] });

    await user.click(
      screen.getAllByRole("button", { name: RELEASED_ITEM.taskName })[0],
    );

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

    await user.click(screen.getAllByRole("button", { name: ITEM.taskName })[0]);
    await user.click(
      screen.getAllByRole("button", { name: SECOND_ITEM.taskName })[0],
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
