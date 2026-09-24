import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import messages from "../../../../../messages/en.json";

const fullCalendarMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { info: toastInfoMock, error: vi.fn() },
}));

vi.mock("@fullcalendar/react", () => ({
  default: (props: FullCalendarProps) => {
    fullCalendarMock(props);
    return null;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => null,
}));

import { WorkspaceCalendar } from "./workspace-calendar";

function renderCalendar(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={messages}
      formats={createFormats("h12")}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const TASK_STATUS_LABELS = {
  QUEUED: "Scheduled",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  INPUT_REQUIRED: "Input required",
} as const;

interface FullCalendarProps {
  eventContent?: (info: {
    event: { id: string; title: string; start?: Date | null };
  }) => ReactNode;
  initialView?: string;
}

const WEEK_SOURCE: WorkspaceCalendarSource = {
  sourceId: "workspace:workspace-1",
  sourceType: "WORKSPACE",
  displayName: "Ada's workspace",
  logoUrl: null,
  paletteToken: "blue",
  isSchedulable: true,
};

const WEEK_ITEM: WorkspaceCalendarItem = {
  id: "occurrence-1",
  taskId: "task-1",
  canEditSchedule: true,
  canMutateOccurrence: true,
  scheduleRevision: 3,
  taskName: "Prepare release notes",
  taskStatus: "QUEUED",
  taskAssigneeId: null,
  taskOwnerId: "user-1",
  scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
  originalScheduledAt: new Date("2026-08-18T09:00:00.000Z"),
  state: "PLANNED",
  sourceId: "workspace:workspace-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "WORKSPACE",
  sourceProjectId: null,
  sourceAccuracy: "EXACT",
  timeAccuracy: "EXACT",
};

describe("WorkspaceCalendar week layout", () => {
  it.each([
    "QUEUED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "INPUT_REQUIRED",
  ] as const)(
    "shows an accessible icon-only badge for %s tasks",
    (taskStatus) => {
      const label = TASK_STATUS_LABELS[taskStatus];
      renderCalendar(
        <NuqsTestingAdapter>
          <WorkspaceCalendar
            initialDate="2026-08-18"
            items={[{ ...WEEK_ITEM, taskStatus }]}
          />
        </NuqsTestingAdapter>,
      );
      const props = fullCalendarMock.mock.lastCall?.[0] as
        | FullCalendarProps
        | undefined;
      renderCalendar(
        <>
          {props?.eventContent?.({
            event: {
              id: WEEK_ITEM.id,
              title: WEEK_ITEM.taskName,
              start: WEEK_ITEM.scheduledAt,
            },
          })}
        </>,
      );
      const card = within(screen.getByTestId("calendar-event"));
      expect(card.getByRole("img", { name: label })).toHaveAttribute(
        "title",
        label,
      );
      expect(card.queryByText(label)).not.toBeInTheDocument();
    },
  );

  it("labels skipped occurrences as skipped rather than showing the task's live status", () => {
    renderCalendar(
      <NuqsTestingAdapter>
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={[{ ...WEEK_ITEM, state: "SKIPPED", taskStatus: "RUNNING" }]}
        />
      </NuqsTestingAdapter>,
    );
    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    renderCalendar(
      <>
        {props?.eventContent?.({
          event: {
            id: WEEK_ITEM.id,
            title: WEEK_ITEM.taskName,
            start: WEEK_ITEM.scheduledAt,
          },
        })}
      </>,
    );
    const card = within(screen.getByTestId("calendar-event"));
    expect(card.getByRole("img", { name: "Skipped" })).toHaveAttribute(
      "title",
      "Skipped",
    );
    expect(
      card.queryByRole("img", { name: "Running" }),
    ).not.toBeInTheDocument();
  });

  // Stacked day-grid rows keep every concurrent task full width and visible;
  // a time grid would squeeze them into side-by-side lanes.
  it("stacks the week in a day grid by default", () => {
    renderCalendar(
      <NuqsTestingAdapter>
        <WorkspaceCalendar initialDate="2026-08-18" items={[WEEK_ITEM]} />
      </NuqsTestingAdapter>,
    );

    expect(
      fullCalendarMock.mock.calls.map(
        ([props]) => (props as FullCalendarProps).initialView,
      ),
    ).toContain("dayGridWeek");
  });

  // Two stacked rows: the day-grid column is too narrow for one line, so the
  // localized time and its source sit above the task name, which keeps the
  // full width.
  it("renders week events as a time line above the task name", () => {
    renderCalendar(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={[WEEK_ITEM]}
          sources={[WEEK_SOURCE]}
        />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    renderCalendar(
      <>
        {props?.eventContent?.({
          event: {
            id: WEEK_ITEM.id,
            title: WEEK_ITEM.taskName,
            start: WEEK_ITEM.scheduledAt,
          },
        })}
      </>,
    );

    const event = screen.getByTestId("calendar-event");
    const [metaLine, titleLine] = Array.from(event.children);
    expect(metaLine).toHaveTextContent("9:00 AM");
    expect(metaLine).toHaveTextContent("Ada's workspace");
    expect(titleLine).toHaveTextContent("Prepare release notes");
  });

  // Two lines of title, then who is on it: the assignee (a coworker or a
  // member) and the owner who put it on the calendar.
  it("wraps the title to two lines and shows assignee and owner avatars", () => {
    renderCalendar(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          coworkers={[
            { id: "user-1", kind: "user", name: "Ada Lovelace", image: "" },
            { id: "coworker-1", kind: "coworker", name: "Scout", image: "" },
          ]}
          initialDate="2026-08-18"
          items={[{ ...WEEK_ITEM, taskAssigneeId: "coworker-1" }]}
          sources={[WEEK_SOURCE]}
        />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    renderCalendar(
      <>
        {props?.eventContent?.({
          event: {
            id: WEEK_ITEM.id,
            title: WEEK_ITEM.taskName,
            start: WEEK_ITEM.scheduledAt,
          },
        })}
      </>,
    );

    const [, titleLine] = Array.from(
      screen.getByTestId("calendar-event").children,
    );
    expect(titleLine).toHaveClass("line-clamp-2");
    expect(
      screen.getByRole("button", {
        name: "Prepare release notes, Ada's workspace",
      }),
    ).toHaveAccessibleDescription("Scout, Ada Lovelace");
    expect(screen.getByTestId("calendar-event-people")).toHaveAttribute(
      "title",
      "Scout, Ada Lovelace",
    );
  });

  // The card itself must stay a plain element so FullCalendar can start a
  // drag from it; the menu opens from a tap on it or from its own button.
  it("keeps the card out of the menu trigger and opens the menu on tap", () => {
    renderCalendar(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar initialDate="2026-08-18" items={[WEEK_ITEM]} />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    renderCalendar(
      <>
        {props?.eventContent?.({
          event: {
            id: WEEK_ITEM.id,
            title: WEEK_ITEM.taskName,
            start: WEEK_ITEM.scheduledAt,
          },
        })}
      </>,
    );

    const card = screen.getByTestId("calendar-event");
    expect(card.tagName).toBe("DIV");
    expect(card).not.toHaveAttribute("aria-haspopup");
    expect(
      screen.getByRole("button", {
        name: "Prepare release notes, Workspace",
      }),
    ).toHaveAttribute("aria-haspopup", "menu");

    fireEvent.click(card);

    expect(
      screen.getByRole("menuitem", { name: "Open task" }),
    ).toBeInTheDocument();
  });

  // FullCalendar ignores a drag on a card the caller cannot move, which
  // used to leave the browser selecting text. The card is unselectable and
  // a mouse drag on someone else's task explains who can reschedule it.
  it("explains a mouse drag on a task the caller does not own", () => {
    renderCalendar(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={[
            {
              ...WEEK_ITEM,
              canEditSchedule: false,
              canMutateOccurrence: false,
            },
          ]}
        />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    renderCalendar(
      <>
        {props?.eventContent?.({
          event: {
            id: WEEK_ITEM.id,
            title: WEEK_ITEM.taskName,
            start: WEEK_ITEM.scheduledAt,
          },
        })}
      </>,
    );

    const card = screen.getByTestId("calendar-event");
    expect(card).toHaveClass("select-none");

    fireEvent.pointerDown(card, {
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(card, {
      pointerType: "mouse",
      clientX: 3,
      clientY: 0,
    });
    expect(toastInfoMock).not.toHaveBeenCalled();

    fireEvent.pointerMove(card, {
      pointerType: "mouse",
      clientX: 20,
      clientY: 0,
    });
    expect(toastInfoMock).toHaveBeenCalledWith(
      "Only the task owner can reschedule it.",
    );
  });
});
