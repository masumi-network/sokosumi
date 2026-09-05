import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";

const getTaskByIdMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(value),
  }),
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === "event.accessibleName" ? `${values?.task}, ${values?.source}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => null,
}));

vi.mock("@/components/task-schedule-section", () => ({
  TaskScheduleSection: () => null,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getTaskById: getTaskByIdMock,
    getWorkspaceCalendar: vi.fn(),
  },
}));

import { WorkspaceCalendar } from "./workspace-calendar";

const ITEM: WorkspaceCalendarItem = {
  id: "occurrence-1",
  taskId: "task-1",
  canEditSchedule: true,
  taskName: "Prepare release notes",
  taskStatus: "QUEUED",
  taskAssigneeId: null,
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

  it("opens task creation from the visible create control", async () => {
    const user = userEvent.setup();
    renderCalendar("month");

    await user.click(screen.getByRole("button", { name: "create.title" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("create.title");
  });
});
