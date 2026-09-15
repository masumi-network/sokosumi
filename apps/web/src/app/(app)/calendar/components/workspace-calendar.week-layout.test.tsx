import { render } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCalendarItem } from "@/lib/clients/generated/core";

const fullCalendarMock = vi.hoisted(() => vi.fn());

vi.mock("@fullcalendar/react", () => ({
  default: ({ initialView }: FullCalendarProps) => {
    fullCalendarMock({ initialView });
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
});
