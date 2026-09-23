import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskSchedule } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskSchedulesView } from "./task-schedules-view";

const { replaceMock, searchParamsRef } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams("tab=schedules") },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(", ")})` : key,
  useFormatter: () => ({ dateTime: () => "Mon, 9:00" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("./task-schedule-dialog", () => ({
  TaskScheduleDialog: () => <div role="dialog" aria-label="schedule dialog" />,
}));

vi.mock("@/app/tasks/actions", () => ({
  loadMoreTaskSchedules: vi.fn(),
}));

const ELENA: CoworkerOption = {
  id: "cow_1",
  slug: "elena",
  name: "Elena",
  image: "",
  kind: "coworker",
  vendor: {
    id: "v1",
    name: "Vendor",
    slug: "vendor",
    logos: { light: null, dark: null },
  },
};

function schedule(overrides: Partial<TaskSchedule>): TaskSchedule {
  return {
    id: "01960001-0001-7001-8001-000000000001",
    workspaceId: "11111111-1111-7111-8111-111111111111",
    organizationId: null,
    ownerId: "user_1",
    creatorUserId: "user_1",
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    state: "ACTIVE",
    rule: {
      expr: "0 9 * * MON",
      timezone: "UTC",
      intervalDays: null,
      anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    },
    ruleEffectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    releasedCount: 0,
    nextRunAt: new Date("2030-01-07T09:00:00.000Z"),
    revision: 0,
    name: "Weekly report",
    description: null,
    projectId: null,
    visibility: "PUBLIC",
    assigneeId: "cow_1",
    assigneeSokoBotId: null,
    assigneeUserId: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderView(schedules: TaskSchedule[] | null) {
  return render(
    <TaskSchedulesView
      schedules={schedules}
      nextCursor={null}
      coworkerOptions={[ELENA]}
      projectOptions={[]}
      canCreate
      canCreatePrivate={false}
    />,
  );
}

describe("TaskSchedulesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams("tab=schedules");
  });

  it("lists each schedule with its rule, next Run, state, and assignee", () => {
    renderView([
      schedule({}),
      schedule({
        id: "01960001-0001-7001-8001-000000000002",
        name: "Paused digest",
        state: "PAUSED",
        nextRunAt: null,
        assigneeId: null,
      }),
    ]);

    const [weekly, paused] = screen.getAllByRole("listitem");
    const weeklyLink = within(weekly).getByRole("link", {
      name: /Weekly report/,
    });
    expect(weeklyLink).toHaveAttribute(
      "href",
      "/tasks/schedules/01960001-0001-7001-8001-000000000001",
    );
    expect(weekly).toHaveTextContent("option.weeklyWithWeekdayTime");
    expect(weekly).toHaveTextContent("nextRun(Mon, 9:00)");
    expect(weekly).toHaveTextContent("state.ACTIVE");
    expect(weekly).toHaveTextContent("Elena");

    expect(paused).toHaveTextContent("state.PAUSED");
    expect(paused).toHaveTextContent("noNextRun");
    expect(paused).toHaveTextContent("unassigned");
  });

  it("filters by state through the URL, keeping the other params", async () => {
    const user = userEvent.setup();
    renderView([schedule({})]);

    await user.click(screen.getByRole("radio", { name: "state.PAUSED" }));

    expect(replaceMock).toHaveBeenCalledWith(
      "/tasks?tab=schedules&scheduleState=PAUSED",
    );
  });

  it("clears the state filter", async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams(
      "tab=schedules&scheduleState=ENDED",
    );
    renderView([]);

    expect(screen.getByRole("radio", { name: "state.ENDED" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "filterAll" }));

    expect(replaceMock).toHaveBeenCalledWith("/tasks?tab=schedules");
  });

  it("says when there is nothing to show and offers to create one", async () => {
    const user = userEvent.setup();
    renderView([]);

    expect(screen.getByText("empty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "newSchedule" }));

    expect(
      screen.getByRole("dialog", { name: "schedule dialog" }),
    ).toBeInTheDocument();
  });

  it("shows a loading state until the schedules arrive", () => {
    renderView(null);

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
