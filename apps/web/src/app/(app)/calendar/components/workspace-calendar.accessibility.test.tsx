import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TASKS_RETURN_PATH_SESSION_KEY,
  TASKS_RETURN_TASK_SESSION_KEY,
} from "@/app/tasks/components/task-navigation";

const pushMock = vi.hoisted(() => vi.fn());
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
    useLocale: () => "en",
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

vi.mock("@/lib/actions/task-schedule/action", () => ({
  changeTaskScheduleRun: vi.fn(),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getWorkspaceCalendar: vi.fn() },
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
  taskAssigneeId: null,
  taskOwnerId: "user-1",
  scheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  originalScheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  state: "PLANNED",
  sourceId: "workspace:workspace-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "WORKSPACE",
  sourceProjectId: null,
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

describe("WorkspaceCalendar accessibility", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it.each(
    (["month", "week", "agenda"] as const).flatMap((view) => [
      { key: "Enter", view },
      { key: "Space", view },
    ]),
  )(
    "opens the Run menu from its one accessible trigger in $view view with $key",
    async ({ key, view }) => {
      const user = userEvent.setup();
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
        screen.getByRole("menuitem", { name: "event.skipRun" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "event.openSchedule" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("menuitem", { name: "event.moveRun" }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("runMove.title");
      expect(within(dialog).getByLabelText("runMove.label")).toHaveAttribute(
        "type",
        "datetime-local",
      );
    },
  );

  it("opens a released Run's Task from its one accessible control", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/calendar?timezone=UTC&view=month");
    const { container } = render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&view=month">
        <WorkspaceCalendar
          initialDate="2030-01-02"
          items={[
            {
              ...ITEM,
              canChangeRun: false,
              state: "RELEASED",
              taskId: "task-1",
              taskStatus: "READY",
            },
          ]}
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
    expect(event).not.toHaveAttribute("aria-haspopup");
    (event as HTMLButtonElement).focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/tasks/task-1");
    // The task's Back returns to this view.
    expect(window.sessionStorage.getItem(TASKS_RETURN_PATH_SESSION_KEY)).toBe(
      "/calendar?timezone=UTC&view=month",
    );
    expect(window.sessionStorage.getItem(TASKS_RETURN_TASK_SESSION_KEY)).toBe(
      "/tasks/task-1",
    );
  });

  it("schedules a task from a labelled toolbar button, by keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&view=week">
        <WorkspaceCalendar
          initialDate="2030-01-02"
          items={[]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );
    const fab = container.querySelector("[data-list-mobile-create-fab]");
    const button = screen
      .getAllByRole("button", { name: "create.fab" })
      .find((candidate) => !fab?.contains(candidate));

    expect(button).toHaveClass("max-md:hidden");
    button?.focus();
    await user.keyboard("{Enter}");

    expect(openCreateTaskModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runAt: expect.objectContaining({ timezone: "UTC" }),
      }),
    );
  });

  it("says an empty week is empty while another week holds runs", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC&view=week">
        <WorkspaceCalendar
          initialDate="2030-01-20"
          items={[ITEM]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });

  it.each([
    { search: "", empty: ["empty.title", "empty.hint", "empty.createHint"] },
    { search: "&status=READY", empty: ["empty.filtered"] },
    { search: "&types=tasks", empty: ["empty.filtered"] },
  ])(
    "tells an empty week from a filtered one ($search)",
    ({ search, empty }) => {
      render(
        <NuqsTestingAdapter searchParams={`?timezone=UTC&view=week${search}`}>
          <WorkspaceCalendar
            initialDate="2030-01-02"
            items={[]}
            sources={SOURCES}
          />
        </NuqsTestingAdapter>,
      );

      for (const key of [
        "empty.title",
        "empty.hint",
        "empty.createHint",
        "empty.filtered",
      ]) {
        if (empty.includes(key)) {
          expect(screen.getByText(key)).toBeInTheDocument();
        } else {
          expect(screen.queryByText(key)).not.toBeInTheDocument();
        }
      }
    },
  );

  it("offers the Run views and leaves Task Schedules to /schedules", () => {
    renderCalendar("month");

    for (const view of ["month", "week", "agenda"]) {
      expect(
        screen.getByRole("radio", { name: `view.${view}` }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("radio", { name: "view.schedules" }),
    ).not.toBeInTheDocument();
  });
});
