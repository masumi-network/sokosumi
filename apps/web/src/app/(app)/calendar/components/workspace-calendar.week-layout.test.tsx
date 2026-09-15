import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCalendarItem } from "@/lib/clients/generated/core";

const fullCalendarMock = vi.hoisted(() => vi.fn());

vi.mock("@fullcalendar/react", () => ({
  default: (props: FullCalendarProps) => {
    fullCalendarMock(props);
    return null;
  },
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "" }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => null,
}));

import { WorkspaceCalendar } from "./workspace-calendar";

interface FullCalendarProps {
  eventContent?: (info: {
    event: { id: string; title: string };
    timeText?: string;
  }) => ReactNode;
  initialView?: string;
}

const WEEK_ITEM: WorkspaceCalendarItem = {
  id: "occurrence-1",
  taskId: "task-1",
  canEditSchedule: true,
  canMoveOccurrence: true,
  scheduleRevision: 3,
  taskName: "Prepare release notes",
  taskStatus: "QUEUED",
  taskAssigneeId: null,
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
  // time sits above the task name and the title keeps the full width.
  it("renders week events as a time line above the task name", () => {
    render(
      <NuqsTestingAdapter>
        <WorkspaceCalendar initialDate="2026-08-18" items={[WEEK_ITEM]} />
      </NuqsTestingAdapter>,
    );

    const props = fullCalendarMock.mock.lastCall?.[0] as
      | FullCalendarProps
      | undefined;
    render(
      <>
        {props?.eventContent?.({
          event: { id: WEEK_ITEM.id, title: WEEK_ITEM.taskName },
          timeText: "9:00a",
        })}
      </>,
    );

    const event = screen.getByRole("button", { name: "event.accessibleName" });
    const [metaLine, titleLine] = Array.from(event.children);
    expect(metaLine).toHaveTextContent("9:00a");
    expect(titleLine).toHaveTextContent("Prepare release notes");
  });
});
