import type { ProjectListItem, TaskSchedule } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskScheduleActions } from "./task-schedule-actions";

const {
  changeTaskScheduleStateMock,
  deleteTaskScheduleMock,
  loadMoreProjectsMock,
  pushMock,
  refreshMock,
  runTaskScheduleNowMock,
  toastMock,
} = vi.hoisted(() => ({
  changeTaskScheduleStateMock: vi.fn(),
  deleteTaskScheduleMock: vi.fn(),
  loadMoreProjectsMock: vi.fn(),
  runTaskScheduleNowMock: vi.fn(),
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
  runTaskScheduleNow: runTaskScheduleNowMock,
}));

vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: loadMoreProjectsMock,
}));

vi.mock("./task-schedule-dialog", () => ({
  TaskScheduleDialog: ({
    schedule,
    copyOf,
    onSaved,
  }: {
    schedule?: TaskSchedule;
    copyOf?: TaskSchedule;
    onSaved?: (scheduleId: string) => void;
  }) =>
    copyOf ? (
      <div
        role="dialog"
        aria-label={`copy ${copyOf.name} into ${copyOf.projectId ?? "none"}`}
      >
        <button type="button" onClick={() => onSaved?.("copy-id")}>
          save copy
        </button>
      </div>
    ) : (
      <div role="dialog" aria-label={`edit ${schedule?.name}`} />
    ),
}));

const SCHEDULE_ID = "01960001-0001-7001-8001-000000000042";

function schedule(state: TaskSchedule["state"]): TaskSchedule {
  return {
    id: SCHEDULE_ID,
    creator: null,
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
    canWrite: true,
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

function project(
  id: string,
  extra: Partial<ProjectListItem> = {},
): ProjectListItem {
  return {
    id,
    name: id,
    logo: null,
    cmo: false,
    closingAt: null,
    closedAt: null,
    ...extra,
  } as ProjectListItem;
}

function page(projects: ProjectListItem[], nextCursor: string | null) {
  return { projects, nextCursor };
}

function renderCopyToProject() {
  return render(
    <TaskScheduleActions
      schedule={{ ...schedule("ACTIVE"), projectId: "p_here" }}
      coworkerOptions={[]}
      projectOptions={[]}
      canCreatePrivate={false}
    />,
  );
}

async function openProjectPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "more" }));
  await user.click(screen.getByRole("menuitem", { name: "copyToProject" }));
}

const OK = { ok: true, value: { scheduleId: SCHEDULE_ID } };

describe("TaskScheduleActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeTaskScheduleStateMock.mockResolvedValue(OK);
    deleteTaskScheduleMock.mockResolvedValue(OK);
    runTaskScheduleNowMock.mockResolvedValue({
      ok: true,
      value: { scheduleId: SCHEDULE_ID, taskId: "task_now" },
    });
  });

  it.each(["ACTIVE", "PAUSED"] as const)(
    "runs a %s schedule now and links to the new Task",
    async (state) => {
      const user = userEvent.setup();
      renderActions(state);

      await user.click(screen.getByRole("button", { name: "runNow" }));

      expect(runTaskScheduleNowMock).toHaveBeenCalledWith({
        scheduleId: SCHEDULE_ID,
        expectedRevision: 1,
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(toastMock.success).toHaveBeenCalledWith("ranNow", {
        duration: Infinity,
        closeButton: true,
        action: { label: "openTask", onClick: expect.any(Function) },
      });
      toastMock.success.mock.calls[0][1].action.onClick();
      expect(pushMock).toHaveBeenCalledWith("/tasks/task_now");
    },
  );

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

  it("blocks another Run now submit while the first is pending", async () => {
    let complete: (() => void) | undefined;
    runTaskScheduleNowMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      return { ok: false, error: { kind: "failed", message: "Failed" } };
    });
    const user = userEvent.setup();
    renderActions("ACTIVE");
    const button = screen.getByRole("button", { name: "runNow" });

    await user.click(button);
    expect(button).toBeDisabled();
    for (const control of screen.getAllByRole("button")) {
      expect(control).toBeDisabled();
    }
    await user.click(button);
    expect(runTaskScheduleNowMock).toHaveBeenCalledTimes(1);
    expect(complete).toBeDefined();
    complete?.();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(toastMock.error).toHaveBeenCalledWith("failed");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
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

    await user.click(screen.getByRole("button", { name: "more" }));
    await user.click(screen.getByRole("menuitem", { name: "end" }));
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

    await user.click(screen.getByRole("button", { name: "more" }));
    await user.click(screen.getByRole("menuitem", { name: "delete" }));
    expect(screen.getByText("confirmDeleteDescription")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "confirmDelete" }));

    expect(deleteTaskScheduleMock).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/schedules"));
  });

  it("hides delete on a schedule without an owner unless the viewer may manage it", async () => {
    const user = userEvent.setup();
    const ownerless = { ...schedule("ACTIVE"), ownerId: null };
    const { rerender } = render(
      <TaskScheduleActions
        schedule={ownerless}
        coworkerOptions={[]}
        projectOptions={[]}
        canCreatePrivate={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "more" }));
    expect(screen.queryByRole("menuitem", { name: "delete" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "edit" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    rerender(
      <TaskScheduleActions
        schedule={ownerless}
        coworkerOptions={[]}
        projectOptions={[]}
        canCreatePrivate={false}
        canDeleteUnowned
      />,
    );

    await user.click(screen.getByRole("button", { name: "more" }));
    expect(
      screen.getByRole("menuitem", { name: "delete" }),
    ).toBeInTheDocument();
  });

  it("leaves an Ended schedule nothing to change but copying or deleting it", async () => {
    const user = userEvent.setup();
    renderActions("ENDED");

    for (const name of ["pause", "resume", "runNow"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    await user.click(screen.getByRole("button", { name: "more" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["copy", "copyToProject", "delete"]);
  });

  it.each(["ACTIVE", "ENDED"] as const)(
    "copies a %s schedule into a new one and opens the copy",
    async (state) => {
      const user = userEvent.setup();
      renderActions(state);

      await user.click(screen.getByRole("button", { name: "more" }));
      await user.click(screen.getByRole("menuitem", { name: "copy" }));
      await user.click(
        within(
          screen.getByRole("dialog", { name: "copy Daily digest into none" }),
        ).getByRole("button", { name: "save copy" }),
      );

      expect(pushMock).toHaveBeenCalledWith("/schedules/copy-id");
    },
  );

  it("skips past pages of closing, closed, CMO and own Projects to the first destination", async () => {
    loadMoreProjectsMock
      .mockResolvedValueOnce(
        page(
          [
            project("p_here"),
            project("p_closing", { closingAt: new Date("2030-01-01") }),
            project("p_closed", { closedAt: new Date("2030-01-01") }),
            project("p_cmo", { cmo: true }),
          ],
          "c1",
        ),
      )
      .mockResolvedValueOnce(page([project("p_there")], null));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);

    expect(
      await screen.findByRole("option", { name: /p_there$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([expect.stringMatching(/p_there$/), "copyToProjectLoadMore"]);
    expect(loadMoreProjectsMock.mock.calls.map(([call]) => call)).toEqual([
      { cursor: null, query: undefined, state: "open" },
      { cursor: "c1", query: undefined, state: "open" },
    ]);
  });

  it("loads destinations past the first page and copies into the chosen one", async () => {
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_first")], "c1"))
      .mockResolvedValueOnce(page([project("p_second")], null));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    await user.click(
      await screen.findByRole("option", { name: "copyToProjectLoadMore" }),
    );
    await user.click(await screen.findByRole("option", { name: /p_second$/ }));
    expect(screen.queryByRole("option")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "copy Daily digest into p_second" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "save copy" }));
    expect(pushMock).toHaveBeenCalledWith("/schedules/copy-id");
  });

  it("offers the viewer's Hidden Projects once the Open ones run out", async () => {
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_here")], null))
      .mockResolvedValueOnce(page([project("p_hidden")], null));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);

    expect(
      await screen.findByRole("option", { name: /p_hidden$/ }),
    ).toBeInTheDocument();
    expect(loadMoreProjectsMock).toHaveBeenLastCalledWith({
      cursor: null,
      query: undefined,
      state: "hidden",
    });
  });

  it("searches every Project by name on the server", async () => {
    loadMoreProjectsMock.mockImplementation(
      async ({ query }: { query?: string }) =>
        page(query === "old" ? [project("p_old")] : [], null),
    );
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    await screen.findByText("copyToProjectNone");
    await user.type(screen.getByRole("combobox"), "old");

    expect(
      await screen.findByRole("option", { name: /p_old$/ }),
    ).toBeInTheDocument();
    expect(loadMoreProjectsMock).toHaveBeenCalledWith({
      cursor: null,
      query: "old",
      state: "open",
    });
  });

  it("says when loading destinations failed", async () => {
    loadMoreProjectsMock.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);

    expect(await screen.findByText("copyToProjectFailed")).toBeInTheDocument();
    expect(screen.queryByText("copyToProjectNone")).toBeNull();
  });

  it("says when no other Project can take the copy, and cancelling writes nothing", async () => {
    const user = userEvent.setup();
    loadMoreProjectsMock.mockResolvedValue(page([], null));
    renderActions("ACTIVE");

    await openProjectPicker(user);

    expect(await screen.findByText("copyToProjectNone")).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("opens the edit dialog", async () => {
    const user = userEvent.setup();
    renderActions("PAUSED");

    await user.click(screen.getByRole("button", { name: "more" }));
    await user.click(screen.getByRole("menuitem", { name: "edit" }));

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
