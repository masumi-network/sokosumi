import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskFromSchedule } from "./task-from-schedule";

const { getScheduleMock } = vi.hoisted(() => ({
  getScheduleMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { name: string }) =>
    values ? `${key}: ${values.name}` : key,
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: { getSchedule: getScheduleMock },
}));

const SCHEDULE_ID = "01960001-0001-7001-8001-000000000042";

describe("TaskFromSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links a Task a Run created to its Task Schedule", async () => {
    getScheduleMock.mockResolvedValue({ id: SCHEDULE_ID, name: "Weekly" });

    render(await TaskFromSchedule({ scheduleId: SCHEDULE_ID }));

    expect(
      screen.getByRole("link", { name: "fromSchedule: Weekly" }),
    ).toHaveAttribute("href", `/schedules/${SCHEDULE_ID}`);
  });

  it("shows nothing for a Task made by hand", async () => {
    const { container } = render(await TaskFromSchedule({ scheduleId: null }));

    expect(container).toBeEmptyDOMElement();
    expect(getScheduleMock).not.toHaveBeenCalled();
  });

  it("names no schedule the viewer may not open", async () => {
    getScheduleMock.mockResolvedValue(null);

    render(await TaskFromSchedule({ scheduleId: SCHEDULE_ID }));

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("fromHiddenSchedule")).toBeInTheDocument();
  });
});
