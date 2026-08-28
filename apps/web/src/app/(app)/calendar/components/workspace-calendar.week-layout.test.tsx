import { render } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCalendarItem } from "@/lib/clients/generated/core";

const fullCalendarMock = vi.hoisted(() => vi.fn());

vi.mock("@fullcalendar/react", () => ({
  default: ({
    allDaySlot,
    initialView,
    slotEventOverlap,
  }: FullCalendarProps) => {
    fullCalendarMock({ allDaySlot, initialView, slotEventOverlap });
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
  allDaySlot?: boolean;
  initialView?: string;
  slotEventOverlap?: boolean;
}

const WEEK_ITEM: WorkspaceCalendarItem = {
  id: "occurrence-1",
  taskId: "task-1",
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
  it("puts concurrent timed events in separate lanes", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=week">
        <WorkspaceCalendar initialDate="2026-08-18" items={[WEEK_ITEM]} />
      </NuqsTestingAdapter>,
    );

    const weekProps = fullCalendarMock.mock.calls
      .map(([props]) => props as FullCalendarProps)
      .find((props) => props.initialView === "timeGridWeek");

    expect(
      fullCalendarMock.mock.calls.map(
        ([props]) => (props as FullCalendarProps).initialView,
      ),
    ).toContain("timeGridWeek");
    expect(weekProps).toMatchObject({
      allDaySlot: false,
      slotEventOverlap: false,
    });
  });
});
