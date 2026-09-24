import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskFromSchedule } from "./task-from-schedule";

const { getScheduleMock } = vi.hoisted(() => ({
  getScheduleMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { datetime: string }) =>
    values ? `${key}: ${values.datetime}` : key,
  getFormatter: async () => ({ dateTime: () => "Sep 28" }),
}));

vi.mock("@/app/tasks/utils/task-schedule-view", () => ({
  taskSchedulePath: (id: string) => `/schedules/${id}`,
  formatTaskScheduleRule: () => "Weekly (Monday, 10:00)",
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: { getSchedule: getScheduleMock },
}));

const SCHEDULE_ID = "01960001-0001-7001-8001-000000000042";

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    name: "**Task Name:** Weekly",
    state: "ACTIVE",
    nextRunAt: new Date("2026-09-28T10:00:00Z"),
    rule: {},
    ...overrides,
  };
}

describe("TaskFromSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links to the Task Schedule by its plain name with rule and next run", async () => {
    getScheduleMock.mockResolvedValue(schedule());

    render(await TaskFromSchedule({ scheduleId: SCHEDULE_ID }));

    expect(
      screen.getByRole("link", { name: "Task Name: Weekly" }),
    ).toHaveAttribute("href", `/schedules/${SCHEDULE_ID}`);
    expect(
      screen.getByText("Weekly (Monday, 10:00) · nextRun: Sep 28"),
    ).toBeInTheDocument();
  });

  it("shows the state instead of a next run for a paused schedule", async () => {
    getScheduleMock.mockResolvedValue(schedule({ state: "PAUSED" }));

    render(await TaskFromSchedule({ scheduleId: SCHEDULE_ID }));

    expect(
      screen.getByText("Weekly (Monday, 10:00) · state.PAUSED"),
    ).toBeInTheDocument();
  });

  it("names no schedule the viewer may not open", async () => {
    getScheduleMock.mockResolvedValue(null);

    render(await TaskFromSchedule({ scheduleId: SCHEDULE_ID }));

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("privateSchedule")).toBeInTheDocument();
  });
});
