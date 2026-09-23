import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskSchedule } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskScheduleDialog } from "./task-schedule-dialog";

const { createTaskScheduleMock, updateTaskScheduleMock, toastMock } =
  vi.hoisted(() => ({
    createTaskScheduleMock: vi.fn(),
    updateTaskScheduleMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
  }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "formatted" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/actions/task-schedule/action", () => ({
  createTaskSchedule: createTaskScheduleMock,
  updateTaskSchedule: updateTaskScheduleMock,
}));

const COWORKER: CoworkerOption = {
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

const SCHEDULE: TaskSchedule = {
  id: "01960001-0001-7001-8001-000000000042",
  workspaceId: "11111111-1111-7111-8111-111111111111",
  organizationId: "org_1",
  ownerId: "user_1",
  creatorUserId: "user_1",
  creatorCoworkerId: null,
  creatorSokoBotId: null,
  state: "ACTIVE",
  rule: {
    expr: "30 8 * * MON",
    timezone: "Europe/Berlin",
    intervalDays: null,
    anchorAt: new Date("2030-01-07T07:30:00.000Z"),
    endsMode: "NEVER",
    endsOn: null,
    targetRunCount: null,
  },
  ruleEffectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
  releasedCount: 2,
  nextRunAt: new Date("2030-01-14T07:30:00.000Z"),
  revision: 4,
  name: "Weekly report",
  description: "Summarise the week",
  projectId: null,
  visibility: "PUBLIC",
  assigneeId: "cow_1",
  assigneeSokoBotId: null,
  assigneeUserId: null,
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
};

const onClose = vi.fn();
const onSaved = vi.fn();

function renderDialog(
  props: Partial<Parameters<typeof TaskScheduleDialog>[0]> = {},
) {
  return render(
    <TaskScheduleDialog
      coworkerOptions={[COWORKER]}
      projectOptions={[]}
      canCreatePrivate={false}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
}

describe("TaskScheduleDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTaskScheduleMock.mockResolvedValue({
      ok: true,
      value: { scheduleId: "new-schedule" },
    });
    updateTaskScheduleMock.mockResolvedValue({
      ok: true,
      value: { scheduleId: SCHEDULE.id },
    });
  });

  it("creates a Task Schedule from the blueprint and a daily rule", async () => {
    const user = userEvent.setup();
    renderDialog({
      initialBlueprint: { assigneeId: "cow_1" },
    });

    const save = screen.getByRole("button", { name: "create" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("name"), "Daily digest");
    await user.click(save);

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Daily digest",
        description: null,
        projectId: null,
        visibility: "PUBLIC",
        assigneeId: "cow_1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        rule: expect.objectContaining({
          expr: "0 9 * * *",
          endsMode: "NEVER",
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("new-schedule");
  });

  it("starts from a prefilled blueprint", () => {
    renderDialog({
      initialBlueprint: {
        name: "Review onboarding",
        description: "Check the new accounts",
      },
    });

    expect(screen.getByLabelText("name")).toHaveValue("Review onboarding");
    expect(screen.getByLabelText("description")).toHaveValue(
      "Check the new accounts",
    );
  });

  it("says an edit changes future Runs only, and saves against the revision it read", async () => {
    const user = userEvent.setup();
    renderDialog({ schedule: SCHEDULE });

    expect(screen.getByText("futureOnlyNotice")).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toHaveValue("Weekly report");

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: SCHEDULE.id,
        expectedRevision: 4,
        name: "Weekly report",
        assigneeId: "cow_1",
      }),
    );
    // An unchanged rule is not replaced, so skipped and moved Runs survive.
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "rule",
    );
    expect(createTaskScheduleMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(SCHEDULE.id);
  });

  it("asks to reload when the schedule changed meanwhile", async () => {
    const user = userEvent.setup();
    updateTaskScheduleMock.mockResolvedValue({
      ok: false,
      error: { kind: "stale", message: "changed" },
    });
    renderDialog({ schedule: SCHEDULE });

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("errors.stale"),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
