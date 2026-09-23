import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import type {
  TaskListItem,
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";

const getTaskByIdMock = vi.hoisted(() => vi.fn());
const getTaskScheduleOccurrencesMock = vi.hoisted(() =>
  vi.fn(async () => ({
    data: { scheduleRevision: 3, futureExceptionCount: 0, occurrences: [] },
    meta: { pagination: { nextCursor: null } },
  })),
);
const pushMock = vi.hoisted(() => vi.fn());
const clearTaskScheduleMock = vi.hoisted(() => vi.fn());
const openCreateTaskModalMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({
    handleOpenWithDefaults: openCreateTaskModalMock,
  }),
}));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useTranslations: () => (key: string, values?: Record<string, string>) =>
      key === "event.accessibleName"
        ? `${values?.task}, ${values?.source}`
        : key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => null,
}));

vi.mock("@/components/task-schedule-section", () => ({
  TaskScheduleSection: ({
    canClearSchedule,
    onClearSchedule,
  }: {
    canClearSchedule?: boolean;
    onClearSchedule?: () => void;
  }) =>
    canClearSchedule ? (
      <button type="button" onClick={onClearSchedule}>
        clear schedule
      </button>
    ) : null,
}));

vi.mock("@/lib/actions/task/action", () => ({
  clearTaskSchedule: clearTaskScheduleMock,
  createScheduledTask: vi.fn(),
  saveCalendarTaskSchedule: vi.fn(),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getTaskById: getTaskByIdMock,
    getTaskScheduleOccurrences: getTaskScheduleOccurrencesMock,
    getWorkspaceCalendar: vi.fn(),
  },
}));

vi.mock("@/lib/utils/task-schedule", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/utils/task-schedule")>();
  return {
    ...actual,
    metadataToSelection: () => ({
      mode: "recurring",
      cron: "0 9 * * *",
      timezone: "UTC",
    }),
  };
});

import { WorkspaceCalendar } from "./workspace-calendar";

const ITEM: WorkspaceCalendarItem = {
  id: "occurrence-1",
  taskId: "task-1",
  canEditSchedule: true,
  canMutateOccurrence: true,
  scheduleRevision: 3,
  taskName: "Prepare release notes",
  taskStatus: "QUEUED",
  taskAssigneeId: null,
  taskOwnerId: "user-1",
  scheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  originalScheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  state: "PLANNED",
  sourceId: "workspace:workspace-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "WORKSPACE",
  sourceProjectId: null,
  sourceAccuracy: "EXACT",
  timeAccuracy: "EXACT",
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
];

const SCHEDULED_TASK: TaskListItem = {
  id: "task-1",
  createdAt: new Date("2030-01-02T09:00:00.000Z"),
  updatedAt: new Date("2030-01-02T09:00:00.000Z"),
  ownerId: "user-1",
  owner: { id: "user-1", name: "Ada", image: null },
  userId: "user-1",
  user: { id: "user-1", name: "Ada", image: null },
  organizationId: null,
  organization: null,
  projectId: null,
  project: null,
  assigneeId: null,
  assigneeSokoBotId: null,
  assigneeUserId: null,
  assignee: null,
  coworkerId: null,
  coworker: null,
  creator: {
    type: "user",
    id: "user-1",
    user: { id: "user-1", name: "Ada", image: null },
  },
  sokoBotId: null,
  sokoBot: null,
  name: "Prepare release notes",
  description: null,
  status: "QUEUED",
  visibility: "PUBLIC",
  grantResumeStatus: null,
  pendingVendorGrantId: null,
  metadata: JSON.stringify({
    version: 1,
    scheduledAt: "2030-01-02T09:00:00.000Z",
    mode: "recurring",
    expr: "0 9 * * *",
    timezone: "UTC",
  }),
  nextRunAt: new Date("2030-01-03T09:00:00.000Z"),
  runAt: null,
  scheduleId: null,
  workspace: {
    id: "workspace-1",
    organizationId: null,
    organization: null,
  },
  jobsCount: 0,
  commentsCount: 0,
};

function renderCalendar(view: "month" | "week" | "agenda") {
  return render(
    <NuqsTestingAdapter searchParams={`?timezone=UTC&view=${view}`}>
      <WorkspaceCalendar
        initialDate="2030-01-02"
        items={[ITEM]}
        sources={SOURCES}
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

describe("WorkspaceCalendar accessibility", () => {
  it.each(
    (["month", "week", "agenda"] as const).flatMap((view) => [
      { key: "Enter", view },
      { key: "Space", view },
    ]),
  )(
    "opens the event menu from its one accessible trigger in $view view with $key",
    async ({ key, view }) => {
      const user = userEvent.setup();
      getTaskByIdMock.mockResolvedValue({
        data: { id: ITEM.taskId, metadata: "{}" },
      });
      const { container } = renderCalendar(view);
      const calendar = container.querySelector(
        `[data-testid="calendar-${view}"]`,
      );
      const event = calendar?.querySelector("button");

      expect(event).not.toBeNull();
      expect(event).toHaveAttribute(
        "aria-label",
        "Prepare release notes, Ada's workspace",
      );
      expect(event).toHaveAttribute("aria-haspopup", "menu");

      (event as HTMLElement).focus();
      await user.keyboard(key === "Enter" ? "{Enter}" : " ");

      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "event.editSchedule" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "event.openTask" }),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("menuitem", { name: "event.editSchedule" }),
      );
      expect(await screen.findByRole("dialog")).toHaveTextContent("edit.title");
    },
  );

  it("offers only Open task for released calendar events", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&view=month">
        <WorkspaceCalendar
          initialDate="2030-01-02"
          items={[{ ...ITEM, canEditSchedule: false, state: "RELEASED" }]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    const event = container.querySelector(
      '[data-testid="calendar-month"] button',
    );
    expect(event).toHaveAttribute(
      "aria-label",
      "Prepare release notes, Ada's workspace",
    );
    await user.click(event as HTMLButtonElement);

    expect(
      screen.queryByRole("menuitem", { name: "event.editSchedule" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "event.openTask" }));
    expect(pushMock).toHaveBeenCalledWith("/tasks/task-1");
  });

  it("announces schedule removal while it is pending", async () => {
    const user = userEvent.setup();
    const request = createDeferred<{
      ok: true;
      value: { taskId: string };
    }>();
    clearTaskScheduleMock.mockReturnValue(request.promise);
    getTaskByIdMock.mockResolvedValue({
      data: { id: ITEM.taskId, metadata: "{}" },
    });
    const { container } = renderCalendar("month");
    const event = container.querySelector(
      '[data-testid="calendar-month"] button',
    );

    await user.click(event as HTMLButtonElement);
    await user.click(
      screen.getByRole("menuitem", { name: "event.editSchedule" }),
    );
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "clear schedule" }));
    await user.click(screen.getByRole("button", { name: "edit.clearConfirm" }));

    expect(screen.getByRole("status")).toHaveTextContent("edit.clearPending");

    await act(async () => {
      request.resolve({ ok: true, value: { taskId: ITEM.taskId } });
      await request.promise;
    });
  });

  it("offers every Calendar view including Schedules", () => {
    renderCalendar("month");

    for (const view of ["month", "week", "agenda", "schedules"]) {
      expect(
        screen.getByRole("tab", { name: `view.${view}` }),
      ).toBeInTheDocument();
    }
  });

  it("opens the series editor from an owned schedule row", async () => {
    const user = userEvent.setup();
    getTaskByIdMock.mockResolvedValue({
      data: { id: SCHEDULED_TASK.id, metadata: SCHEDULED_TASK.metadata },
    });

    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&view=schedules">
        <WorkspaceCalendar
          currentUserId="user-1"
          initialDate="2030-01-02"
          items={[]}
          scheduledTasks={[SCHEDULED_TASK]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("button", { name: "schedules.edit" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("edit.title");
  });
});
