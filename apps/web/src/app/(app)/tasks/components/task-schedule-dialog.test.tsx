import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString() }),
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

const MEMBER: CoworkerOption = {
  ...COWORKER,
  id: "user_2",
  slug: "maya",
  name: "Maya",
  kind: "user",
};

const SOKO_BOT: CoworkerOption = {
  ...COWORKER,
  id: "bot_1",
  slug: "soko-bot",
  name: "Soko Bot",
  kind: "sokoBot",
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
  description: "**Summarise** the week",
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

  it("shows the assignees supplied by Core", async () => {
    const user = userEvent.setup();
    renderDialog({ coworkerOptions: [COWORKER, SOKO_BOT] });

    await user.click(screen.getByRole("combobox", { name: /assignee/ }));

    expect(screen.getByRole("option", { name: "Elena" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Soko Bot" })).toBeEnabled();
    expect(screen.queryByRole("option", { name: "Maya" })).toBeNull();
  });

  it("starts unassigned when repeating a Task assigned to a workspace member", async () => {
    const user = userEvent.setup();
    renderDialog({
      coworkerOptions: [COWORKER],
      initialBlueprint: { name: "Review", assigneeUserId: MEMBER.id },
    });

    expect(
      screen.getByRole("combobox", { name: /assignee/ }),
    ).toHaveTextContent("unassigned");
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });
  });

  it("clears a legacy member assignee when editing a schedule", async () => {
    const user = userEvent.setup();
    renderDialog({
      schedule: {
        ...SCHEDULE,
        assigneeId: null,
        assigneeUserId: MEMBER.id,
      },
    });

    expect(
      screen.getByRole("combobox", { name: /assignee/ }),
    ).toHaveTextContent("unassigned");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });
  });

  it("starts from a prefilled blueprint, with its markdown formatted", () => {
    renderDialog({
      initialBlueprint: {
        name: "Review onboarding",
        description: "**Check** the new accounts",
      },
    });

    expect(screen.getByLabelText("name")).toHaveValue("Review onboarding");
    const description = screen.getByRole("textbox", { name: "description" });
    expect(description).toHaveTextContent("Check the new accounts");
    expect(description.querySelector("strong")).toHaveTextContent("Check");
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
        description: "**Summarise** the week",
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

  it.each([
    ["a custom cron", { expr: "15 7 1,15 * *" }],
    [
      "an every-N-days rule",
      {
        expr: "0 9 * * *",
        intervalDays: 3,
        anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      },
    ],
  ])("keeps %s when only the blueprint changes", async (_label, rule) => {
    const user = userEvent.setup();
    renderDialog({
      schedule: { ...SCHEDULE, rule: { ...SCHEDULE.rule, ...rule } },
    });

    await user.type(screen.getByLabelText("name"), " (team)");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      name: "Weekly report (team)",
    });
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "rule",
    );
  });

  describe("every N days", () => {
    // 09:00 UTC is 10:00 in Berlin in January.
    const EVERY_THREE_DAYS: TaskSchedule = {
      ...SCHEDULE,
      rule: {
        ...SCHEDULE.rule,
        expr: "0 10 * * *",
        intervalDays: 3,
        anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      },
    };

    it("previews every third day from the anchor, not every day", () => {
      renderDialog({ schedule: EVERY_THREE_DAYS });

      const preview = screen
        .getAllByRole("listitem")
        .map((item) => item.textContent);
      expect(preview).toEqual([
        "2030-01-07T09:00:00.000Z",
        "2030-01-10T09:00:00.000Z",
        "2030-01-13T09:00:00.000Z",
      ]);
    });

    it("runs at the time of day the form shows, which Core reads from the anchor", async () => {
      const user = userEvent.setup();
      renderDialog({ schedule: EVERY_THREE_DAYS });

      const timeOfDay = screen.getByLabelText("timeOfDay");
      expect(timeOfDay).toHaveValue("10:00");
      fireEvent.change(timeOfDay, { target: { value: "07:15" } });
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() =>
        expect(updateTaskScheduleMock).toHaveBeenCalledOnce(),
      );
      expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
        rule: {
          expr: "15 7 * * *",
          intervalDays: 3,
          anchorAt: new Date("2030-01-07T06:15:00.000Z"),
          timezone: "Europe/Berlin",
        },
      });
    });
  });

  it("sends the new rule when the time changes", async () => {
    const user = userEvent.setup();
    renderDialog({ schedule: SCHEDULE });

    fireEvent.change(screen.getByLabelText("firstRun"), {
      target: { value: "2030-01-14T10:45" },
    });
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      rule: { expr: "45 10 * * MON", timezone: "Europe/Berlin" },
    });
  });

  it("keeps a private Task private instead of assigning its member", async () => {
    const user = userEvent.setup();
    renderDialog({
      canCreatePrivate: true,
      coworkerOptions: [COWORKER],
      initialBlueprint: {
        name: "Confidential",
        visibility: "PRIVATE",
        assigneeUserId: MEMBER.id,
      },
    });

    expect(screen.getByRole("switch")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Confidential",
        visibility: "PRIVATE",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
      }),
    );
  });

  it("uses Core's agent choices for a private schedule", async () => {
    const user = userEvent.setup();
    renderDialog({
      schedule: { ...SCHEDULE, visibility: "PRIVATE" },
      coworkerOptions: [COWORKER, SOKO_BOT],
    });

    await user.click(screen.getByRole("combobox", { name: /assignee/ }));

    expect(screen.getByRole("option", { name: "Elena" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Soko Bot" })).toBeEnabled();
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
