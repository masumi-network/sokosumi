import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskSchedule } from "@/lib/clients/generated/core";

import { TaskScheduleActions } from "./task-schedule-actions";

const {
  changeTaskScheduleStateMock,
  deleteTaskScheduleMock,
  pushMock,
  refreshMock,
  toastMock,
} = vi.hoisted(() => ({
  changeTaskScheduleStateMock: vi.fn(),
  deleteTaskScheduleMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/actions/task-schedule/action", () => ({
  changeTaskScheduleState: changeTaskScheduleStateMock,
  deleteTaskSchedule: deleteTaskScheduleMock,
}));

vi.mock("./task-schedule-dialog", () => ({
  TaskScheduleDialog: ({ schedule }: { schedule: TaskSchedule }) => (
    <div role="dialog" aria-label={`edit ${schedule.name}`} />
  ),
}));

const SCHEDULE_ID = "01960001-0001-7001-8001-000000000042";

function schedule(state: TaskSchedule["state"]): TaskSchedule {
  return {
    id: SCHEDULE_ID,
    workspaceId: "11111111-1111-7111-8111-111111111111",
    organizationId: null,
    ownerId: "user_1",
    creatorUserId: "user_1",
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    state,
    rule: {
      expr: "0 9 * * *",
      timezone: "UTC",
      intervalDays: null,
      anchorAt: new Date("2030-01-01T09:00:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    },
    ruleEffectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    releasedCount: 0,
    nextRunAt: null,
    revision: 1,
    name: "Daily digest",
    description: null,
    projectId: null,
    visibility: "PUBLIC",
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
  };
}

function renderActions(state: TaskSchedule["state"]) {
  return render(
    <TaskScheduleActions
      schedule={schedule(state)}
      coworkerOptions={[]}
      projectOptions={[]}
      canCreatePrivate={false}
    />,
  );
}

const OK = { ok: true, value: { scheduleId: SCHEDULE_ID } };

describe("TaskScheduleActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeTaskScheduleStateMock.mockResolvedValue(OK);
    deleteTaskScheduleMock.mockResolvedValue(OK);
  });

  it("pauses an Active schedule", async () => {
    const user = userEvent.setup();
    renderActions("ACTIVE");

    expect(screen.queryByRole("button", { name: "resume" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "pause" }));

    expect(changeTaskScheduleStateMock).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      action: "pause",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith("paused");
  });

  it("resumes a Paused schedule", async () => {
    const user = userEvent.setup();
    renderActions("PAUSED");

    expect(screen.queryByRole("button", { name: "pause" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "resume" }));

    expect(changeTaskScheduleStateMock).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      action: "resume",
    });
  });

  it("ends a schedule only after confirming", async () => {
    const user = userEvent.setup();
    renderActions("ACTIVE");

    await user.click(screen.getByRole("button", { name: "end" }));
    expect(changeTaskScheduleStateMock).not.toHaveBeenCalled();
    expect(screen.getByText("confirmEndDescription")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "confirmEnd" }));

    expect(changeTaskScheduleStateMock).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      action: "end",
    });
  });

  it("deletes a schedule after confirming and goes back to the Schedules view", async () => {
    const user = userEvent.setup();
    renderActions("ENDED");

    await user.click(screen.getByRole("button", { name: "delete" }));
    expect(screen.getByText("confirmDeleteDescription")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "confirmDelete" }));

    expect(deleteTaskScheduleMock).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
    });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/tasks?tab=schedules"),
    );
  });

  it("leaves an Ended schedule nothing to change but deleting it", () => {
    renderActions("ENDED");

    for (const name of ["edit", "pause", "resume", "end"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "delete" })).toBeInTheDocument();
  });

  it("opens the edit dialog", async () => {
    const user = userEvent.setup();
    renderActions("PAUSED");

    await user.click(screen.getByRole("button", { name: "edit" }));

    expect(
      screen.getByRole("dialog", { name: "edit Daily digest" }),
    ).toBeInTheDocument();
  });

  it("asks to reload when the state changed meanwhile", async () => {
    const user = userEvent.setup();
    changeTaskScheduleStateMock.mockResolvedValue({
      ok: false,
      error: { kind: "stale", message: "changed" },
    });
    renderActions("ACTIVE");

    await user.click(screen.getByRole("button", { name: "pause" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Dialog.errors.stale"),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
