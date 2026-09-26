import { fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";

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

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useTranslations: () => (key: string) => key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => null,
}));

import { WorkspaceCalendar } from "./workspace-calendar";

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
  scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
  originalScheduledAt: new Date("2026-08-18T09:00:00.000Z"),
  state: "PLANNED",
  sourceId: "workspace:workspace-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "WORKSPACE",
  sourceProjectId: null,
};

describe("WorkspaceCalendar week layout", () => {
  // Stacked day-grid rows keep every concurrent task full width and visible;
  // a time grid would squeeze them into side-by-side lanes.
  it("stacks the week in a day grid by default", () => {
    render(
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
    render(
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
    render(
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
    render(
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
    render(
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
      screen.getByRole("button", { name: "event.accessibleName" }),
    ).toHaveAccessibleDescription("Scout, Ada Lovelace");
    expect(screen.getByTestId("calendar-event-people")).toHaveAttribute(
      "title",
      "Scout, Ada Lovelace",
    );
  });

  // The card itself must stay a plain element so FullCalendar can start a
  // drag from it; the menu opens from a tap on it or from its own button.
  it("keeps the card out of the menu trigger and opens the menu on tap", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar initialDate="2026-08-18" items={[WEEK_ITEM]} />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    render(
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
      screen.getByRole("button", { name: "event.accessibleName" }),
    ).toHaveAttribute("aria-haspopup", "menu");

    fireEvent.click(card);

    expect(
      screen.getByRole("menuitem", { name: "event.openSchedule" }),
    ).toBeInTheDocument();
  });

  // FullCalendar ignores a drag on a card the caller cannot move, which
  // used to leave the browser selecting text. The card is unselectable and
  // a mouse drag on a Run the caller cannot change explains which ones move.
  it("explains a mouse drag on a Run the caller cannot change", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={[
            {
              ...WEEK_ITEM,
              canChangeRun: false,
            },
          ]}
        />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    render(
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
    expect(toastInfoMock).toHaveBeenCalledWith("event.moveNotAllowed");
  });
});
