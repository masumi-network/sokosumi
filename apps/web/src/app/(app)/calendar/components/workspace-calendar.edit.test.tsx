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
import { type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { parseTaskScheduleSelection } from "@/lib/utils/task-schedule";

interface FullCalendarProps {
  borderless?: boolean;
  dateClick?: (info: { date: Date }) => void;
  dayCellClass?: string;
  editable?: boolean;
  eventAllow?: (
    span: Record<string, never>,
    movingEvent: { id: string } | null,
  ) => boolean;
  eventContent?: (info: {
    event: { id: string; title: string; start?: Date | null };
  }) => ReactNode;
  eventDrop?: (info: {
    event: { id: string; start: Date | null };
    revert: () => void;
  }) => void;
  events?: Array<{
    id: string;
    title: string;
    start: string;
    startEditable?: boolean;
    durationEditable?: boolean;
  }>;
  plugins?: unknown[];
}

const {
  calendarRealtimeBridgeMock,
  changeTaskScheduleRunMock,
  filterDropdownMenuMock,
  fullCalendarMock,
  getProjectCalendarMock,
  getWorkspaceCalendarMock,
  interactionPluginMock,
  openCreateTaskModalMock,
  pushMock,
  refreshMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  calendarRealtimeBridgeMock: vi.fn(),
  changeTaskScheduleRunMock: vi.fn(),
  filterDropdownMenuMock: vi.fn(),
  fullCalendarMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
  interactionPluginMock: {},
  openCreateTaskModalMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/ably/calendar-realtime-bridge", () => ({
  CalendarRealtimeBridge: (props: { onInvalidated: () => void }) => {
    calendarRealtimeBridgeMock(props);
    return null;
  },
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
        <button
          type="button"
          onClick={() =>
            props.dateClick?.({ date: new Date("2026-09-08T16:00:00.000Z") })
          }
        >
          past hour calendar slot
        </button>
        <button
          type="button"
          onClick={() =>
            props.dateClick?.({ date: new Date("2026-09-07T22:00:00.000Z") })
          }
        >
          past midnight calendar slot
        </button>
        <button
          type="button"
          onClick={() =>
            props.dateClick?.({ date: new Date("2026-09-08T17:00:00.000Z") })
          }
        >
          future hour calendar slot
        </button>
        {props.events?.map((event) => (
          <div key={event.id}>
            {props.eventContent?.({
              event: { ...event, start: new Date(event.start) },
            }) ?? event.title}
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

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useTranslations: () => (key: string, values?: Record<string, string>) => {
      if (key === "event.accessibleName") {
        return `${values?.task}, ${values?.source}`;
      }
      return key;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({
    handleOpenWithDefaults: openCreateTaskModalMock,
  }),
}));

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

vi.mock("@/lib/actions/task-schedule/action", () => ({
  changeTaskScheduleRun: changeTaskScheduleRunMock,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: getProjectCalendarMock,
    getWorkspaceCalendar: getWorkspaceCalendarMock,
  },
}));

import { WorkspaceCalendar } from "./workspace-calendar";

const ITEM: WorkspaceCalendarItem = {
  id: "run-1",
  kind: "RUN",
  scheduleId: "schedule-1",
  scheduleRevision: 3,
  canChangeRun: true,
  taskId: null,
  taskName: "Prepare release notes",
  taskStatus: null,
  taskAssigneeId: "coworker-1",
  taskOwnerId: "user-1",
  scheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  originalScheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  state: "PLANNED",
  sourceId: "project:project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
  sourceProjectId: "project-1",
};

const READ_ONLY_ITEM: WorkspaceCalendarItem = {
  ...ITEM,
  canChangeRun: false,
};

const RELEASED_ITEM: WorkspaceCalendarItem = {
  ...READ_ONLY_ITEM,
  id: "run-released-1",
  state: "RELEASED",
  taskId: "task-1",
  taskStatus: "COMPLETED",
};

const MOVED_ITEM: WorkspaceCalendarItem = {
  ...ITEM,
  id: "run-moved-1",
  scheduledAt: new Date("2030-01-03T10:30:00.000Z"),
};

const RUN_AT_ITEM: WorkspaceCalendarItem = {
  ...READ_ONLY_ITEM,
  id: "task-run-at-1",
  kind: "RUN_AT",
  scheduleId: null,
  scheduleRevision: null,
  taskId: "task-run-at-1",
  taskStatus: "QUEUED",
  originalScheduledAt: null,
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
  searchParams = "?timezone=UTC",
) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
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

async function openEventMenu(
  user: ReturnType<typeof userEvent.setup>,
  index = 0,
) {
  await user.click(
    screen.getAllByRole("button", {
      name: "Prepare release notes, Release planning",
    })[index],
  );
}

describe("WorkspaceCalendar editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeTaskScheduleRunMock.mockResolvedValue({
      ok: true,
      value: { scheduleId: "schedule-1", runId: "run-1" },
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("configures FullCalendar date clicks with the interaction plugin", () => {
    renderCalendar();

    const props = fullCalendarMock.mock.calls[0]?.[0] as FullCalendarProps;
    expect(props.borderless).toBe(true);
    expect(props.dateClick).toEqual(expect.any(Function));
    expect(props.editable).toBe(false);
    expect(props.plugins).toContain(interactionPluginMock);
  });

  it("colors the actual day cell on hover without an overlay", () => {
    renderCalendar();

    const props = fullCalendarMock.mock.calls[0]?.[0] as FullCalendarProps;
    expect(props.dayCellClass).toContain("hover:bg-primary-quaternary");
    expect(props.dayCellClass).toContain("motion-safe:transition-colors");
    expect(props.dayCellClass).toContain("motion-safe:duration-150");
    expect(props.dayCellClass).toContain("motion-safe:ease-out");
  });

  it("shows a source filter only on the top-level Calendar and includes Projects in pagination", async () => {
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

    await waitFor(() =>
      expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1" }),
      ),
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

    await waitFor(() =>
      expect(getProjectCalendarMock).toHaveBeenCalledWith(
        "project-1",
        expect.not.objectContaining({ projectId: expect.anything() }),
      ),
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

  it("opens create with a schedulable once-time when the clicked hour is already past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));
    render(
      <NuqsTestingAdapter searchParams="?timezone=Europe%2FPrague">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2026-09-08"
          items={[ITEM]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "past hour calendar slot" })[0],
    );

    const schedule = openCreateTaskModalMock.mock.calls.at(-1)?.[0] as {
      schedule: TaskScheduleSelection;
    };
    expect(schedule.schedule).toEqual({
      mode: "once",
      oneTimeLocalIso: "2026-09-08T18:06",
      timezone: "Europe/Prague",
    });

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(parseTaskScheduleSelection(schedule.schedule)).toEqual({
      mode: "once",
      runAt: new Date("2026-09-08T16:06:00.000Z"),
    });
  });

  it("opens create with a schedulable once-time when month midnight is already past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));
    render(
      <NuqsTestingAdapter searchParams="?timezone=Europe%2FPrague">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2026-09-08"
          items={[ITEM]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "past midnight calendar slot" })[0],
    );

    const schedule = openCreateTaskModalMock.mock.calls.at(-1)?.[0] as {
      schedule: TaskScheduleSelection;
    };
    expect(schedule.schedule.oneTimeLocalIso).toBe("2026-09-08T18:06");
    expect(parseTaskScheduleSelection(schedule.schedule)).toEqual({
      mode: "once",
      runAt: new Date("2026-09-08T16:06:00.000Z"),
    });
  });

  it("keeps a future clicked hour as the seeded once-time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));
    render(
      <NuqsTestingAdapter searchParams="?timezone=Europe%2FPrague">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2026-09-08"
          items={[ITEM]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "future hour calendar slot" })[0],
    );

    expect(openCreateTaskModalMock).toHaveBeenCalledWith({
      projectId: undefined,
      schedule: {
        mode: "once",
        oneTimeLocalIso: "2026-09-08T19:00",
        timezone: "Europe/Prague",
      },
    });
  });

  it("prefills the active Workspace source on the workspace Calendar", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&sourceId=workspace%3Aworkspace-1">
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
      expect.objectContaining({ projectId: null }),
    );
  });

  it("does not prefill an unschedulable Workspace source", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&sourceId=workspace%3Aworkspace-1">
        <WorkspaceCalendar
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          initialDate="2030-01-02"
          items={[ITEM]}
          sources={SOURCES.map((source) =>
            source.sourceType === "WORKSPACE"
              ? { ...source, isSchedulable: false }
              : source,
          )}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(
      screen.getAllByRole("button", { name: "empty calendar slot" })[0],
    );

    expect(openCreateTaskModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: undefined }),
    );
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

  it("prefills a Project source supplied through the source filter", async () => {
    const user = userEvent.setup();
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&sourceId=project%3Aproject-1">
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

  it("opens a released Run's Task directly and a planned Run's schedule from its menu", async () => {
    const user = userEvent.setup();
    renderCalendar({ items: [RELEASED_ITEM, ITEM] });

    const released = screen.getAllByRole("button", {
      name: "Prepare release notes, Release planning",
    })[0];
    expect(released).not.toHaveAttribute("aria-haspopup");
    await user.click(released);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/tasks/task-1");

    await openEventMenu(user, 1);
    await user.click(
      screen.getByRole("menuitem", { name: "event.openSchedule" }),
    );
    expect(pushMock).toHaveBeenLastCalledWith("/schedules/schedule-1");
  });

  it("shows a Queued Task at its Run at, opening the Task directly", async () => {
    const user = userEvent.setup();
    renderCalendar({ items: [RUN_AT_ITEM] });

    const props = fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps;
    expect(props.events).toEqual([
      expect.objectContaining({
        id: RUN_AT_ITEM.id,
        start: RUN_AT_ITEM.scheduledAt.toISOString(),
        startEditable: false,
      }),
    ]);

    await openEventMenu(user);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/tasks/task-run-at-1");
  });

  it("makes only Runs the caller can change draggable", () => {
    renderCalendar({
      items: [ITEM, { ...READ_ONLY_ITEM, id: "run-readonly" }, RELEASED_ITEM],
    });

    const props = fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps;
    function event(id: string) {
      return props.events?.find((candidate) => candidate.id === id);
    }
    expect(event(ITEM.id)?.startEditable).toBe(true);
    expect(event("run-readonly")?.startEditable).toBe(false);
    expect(event(RELEASED_ITEM.id)?.startEditable).toBe(false);
    expect(
      props.events?.every((entry) => entry.durationEditable === false),
    ).toBe(true);
    expect(props.editable).toBe(false);
    expect(props.eventAllow?.({}, { id: ITEM.id })).toBe(true);
    expect(props.eventAllow?.({}, { id: "run-readonly" })).toBe(false);
    expect(props.eventAllow?.({}, { id: RELEASED_ITEM.id })).toBe(false);
  });

  it("refuses a drop on a Run the caller cannot change", () => {
    renderCalendar({ items: [READ_ONLY_ITEM] });

    const props = fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps;
    const revert = vi.fn();
    act(() => {
      props.eventDrop?.({
        event: {
          id: READ_ONLY_ITEM.id,
          start: new Date("2030-01-03T10:30:00.000Z"),
        },
        revert,
      });
    });

    expect(revert).toHaveBeenCalledOnce();
    expect(changeTaskScheduleRunMock).not.toHaveBeenCalled();
  });

  it("moves a dropped Run optimistically through the Run route", async () => {
    const request = createDeferred<{
      ok: true;
      value: { scheduleId: string; runId: string };
    }>();
    changeTaskScheduleRunMock.mockReturnValue(request.promise);
    renderCalendar();

    const props = fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps;
    const revert = vi.fn();
    const droppedAt = new Date("2030-01-03T10:30:00.000Z");

    await act(async () => {
      props.eventDrop?.({
        event: { id: ITEM.id, start: droppedAt },
        revert,
      });
    });

    expect(changeTaskScheduleRunMock).toHaveBeenCalledWith({
      scheduleId: "schedule-1",
      runId: ITEM.id,
      expectedRevision: 3,
      action: "move",
      scheduledAt: droppedAt,
    });
    const optimistic = (
      fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps
    ).events?.find((candidate) => candidate.id === ITEM.id);
    expect(optimistic?.start).toBe(droppedAt.toISOString());
    expect(revert).not.toHaveBeenCalled();

    await act(async () => {
      request.resolve({
        ok: true,
        value: { scheduleId: "schedule-1", runId: ITEM.id },
      });
      await request.promise;
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });

  it("rolls a refused drop back and says why", async () => {
    changeTaskScheduleRunMock.mockResolvedValue({
      ok: false,
      error: { kind: "invalid_time", message: "Too far ahead" },
    });
    renderCalendar();

    const props = fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps;
    const revert = vi.fn();

    await act(async () => {
      props.eventDrop?.({
        event: { id: ITEM.id, start: new Date("2030-01-03T10:30:00.000Z") },
        revert,
      });
    });

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("event.runInvalidTime", {
        duration: Infinity,
      }),
    );
    expect(revert).toHaveBeenCalledOnce();
    const rolledBack = (
      fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps
    ).events?.find((candidate) => candidate.id === ITEM.id);
    expect(rolledBack?.start).toBe(ITEM.scheduledAt.toISOString());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes the route when a drop hits a Run that changed meanwhile", async () => {
    changeTaskScheduleRunMock.mockResolvedValue({
      ok: false,
      error: { kind: "stale", message: "Task Schedule changed" },
    });
    renderCalendar();

    const props = fullCalendarMock.mock.calls.at(-1)?.[0] as FullCalendarProps;
    await act(async () => {
      props.eventDrop?.({
        event: { id: ITEM.id, start: new Date("2030-01-03T10:30:00.000Z") },
        revert: vi.fn(),
      });
    });

    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(toastErrorMock).toHaveBeenCalledWith("event.runStale", {
      duration: Infinity,
    });
  });

  it("moves a Run to the time picked in its dialog", async () => {
    const user = userEvent.setup();
    renderCalendar({ items: [ITEM, RELEASED_ITEM] });

    await openEventMenu(user, 1);
    expect(
      screen.queryByRole("menuitem", { name: "event.moveRun" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await openEventMenu(user, 0);
    await user.click(screen.getByRole("menuitem", { name: "event.moveRun" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("runMove.label");
    expect(input).toHaveValue("2030-01-02T09:00");
    fireEvent.change(input, { target: { value: "2030-01-04T08:15" } });
    await user.click(
      within(dialog).getByRole("button", { name: "runMove.confirm" }),
    );

    await waitFor(() =>
      expect(changeTaskScheduleRunMock).toHaveBeenCalledWith({
        scheduleId: "schedule-1",
        runId: ITEM.id,
        expectedRevision: 3,
        action: "move",
        scheduledAt: new Date("2030-01-04T08:15:00.000Z"),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("closes the move dialog and refreshes when the Run changed meanwhile", async () => {
    changeTaskScheduleRunMock.mockResolvedValue({
      ok: false,
      error: { kind: "stale", message: "Task Schedule changed" },
    });
    const user = userEvent.setup();
    renderCalendar();

    await openEventMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "event.moveRun" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "runMove.confirm" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith("event.runStale", {
      duration: Infinity,
    });
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("skips a planned Run from its event menu", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await openEventMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "event.skipRun" }));

    await waitFor(() =>
      expect(changeTaskScheduleRunMock).toHaveBeenCalledWith({
        scheduleId: "schedule-1",
        runId: ITEM.id,
        expectedRevision: 3,
        action: "skip",
      }),
    );
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("restores a moved Run to the rule's time", async () => {
    const user = userEvent.setup();
    renderCalendar({ items: [MOVED_ITEM] });

    await openEventMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "event.restoreRun" }),
    );

    await waitFor(() =>
      expect(changeTaskScheduleRunMock).toHaveBeenCalledWith({
        scheduleId: "schedule-1",
        runId: MOVED_ITEM.id,
        expectedRevision: 3,
        action: "restore",
      }),
    );
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("offers restore only on a moved Run", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await openEventMenu(user);

    expect(
      screen.queryByRole("menuitem", { name: "event.restoreRun" }),
    ).not.toBeInTheDocument();
  });
});
