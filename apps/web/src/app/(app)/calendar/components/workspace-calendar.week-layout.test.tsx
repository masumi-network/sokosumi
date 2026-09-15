import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";

const fullCalendarMock = vi.hoisted(() => vi.fn());

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
  id: "occurrence-1",
  taskId: "task-1",
  canEditSchedule: true,
  canMutateOccurrence: true,
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

    const event = screen.getByRole("button", { name: "event.accessibleName" });
    const [metaLine, titleLine] = Array.from(event.children);
    expect(metaLine).toHaveTextContent("9:00 AM");
    expect(metaLine).toHaveTextContent("Ada's workspace");
    expect(titleLine).toHaveTextContent("Prepare release notes");
  });
});
