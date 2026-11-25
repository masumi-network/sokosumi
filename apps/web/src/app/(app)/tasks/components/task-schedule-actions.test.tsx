import type { ProjectListItem, TaskSchedule } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user_1" },
      session: { activeOrganizationId: null },
    },
  }),
}));

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
    canRunNow: true,
    canEditPlan: true,
  };
}

let queryClient = new QueryClient();

function renderActions(state: TaskSchedule["state"]) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskScheduleActions
        schedule={schedule(state)}
        coworkerOptions={[]}
        projectOptions={[]}
        canCreatePrivate={false}
      />
    </QueryClientProvider>,
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

function renderCopyToProject(scheduleOverrides: Partial<TaskSchedule> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskScheduleActions
        schedule={{
          ...schedule("ACTIVE"),
          projectId: "p_here",
          ...scheduleOverrides,
        }}
        coworkerOptions={[]}
        projectOptions={[]}
        canCreatePrivate={false}
      />
    </QueryClientProvider>,
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
    queryClient = new QueryClient();
    loadMoreProjectsMock.mockReset();
    loadMoreProjectsMock.mockResolvedValue(page([], null));
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
      await waitFor(() =>
        expect(toastMock.success).toHaveBeenCalledWith("ranNow", {
          duration: Infinity,
          closeButton: true,
          action: { label: "openTask", onClick: expect.any(Function) },
        }),
      );
      expect(refreshMock).not.toHaveBeenCalled();
      toastMock.success.mock.calls[0][1].action.onClick();
      expect(pushMock).toHaveBeenCalledWith("/tasks/task_now");
    },
  );

  it.each([
    { auditId: "saved-audit", projectId: null, query: "auditId=saved-audit" },
    {
      projectId: "saved-project",
      query: "projectId=saved-project&view=project",
    },
  ])(
    "opens the specific monitor in SEO after an uncharged Run now refusal ($query)",
    async ({ auditId, projectId, query }) => {
      const user = userEvent.setup();
      runTaskScheduleNowMock.mockResolvedValueOnce({
        ok: false,
        error: { kind: "failed", coverage: "property" },
      });
      render(
        <TaskScheduleActions
          schedule={{
            ...schedule("ACTIVE"),
            projectId,
            seoMonitor: { kind: "audit_full", pageCount: 1, auditId },
          }}
          coworkerOptions={[]}
          projectOptions={[]}
          canCreatePrivate={false}
        />,
      );
      await user.click(screen.getByRole("button", { name: "runNow" }));
      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith(
          "property",
          expect.objectContaining({
            action: { label: "reviewMonitor", onClick: expect.any(Function) },
          }),
        ),
      );
      toastMock.error.mock.calls[0][1].action.onClick();
      expect(pushMock).toHaveBeenCalledWith(
        `/seo?${query}&tab=agent#seo-monitor-${SCHEDULE_ID}`,
      );
      expect(runTaskScheduleNowMock).toHaveBeenCalledTimes(1);
    },
  );

  it("hides manual runs, plan edits and copies for a bounded SEO monitor, keeping state controls", async () => {
    const user = userEvent.setup();
    render(
      <TaskScheduleActions
        schedule={{
          ...schedule("ACTIVE"),
          canRunNow: false,
          canEditPlan: false,
        }}
        coworkerOptions={[]}
        projectOptions={[]}
        canCreatePrivate={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "runNow" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pause" })).toBeVisible();
    expect(runTaskScheduleNowMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "more" }));
    expect(
      screen.queryByRole("menuitem", { name: "edit" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "end" })).toBeVisible();
    for (const name of ["copy", "copyToProject"]) {
      expect(screen.queryByRole("menuitem", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["copy", "copyToProject"])(
    "closes an open %s dialog when a schedule becomes an SEO-managed plan",
    async (action) => {
      const user = userEvent.setup();
      const props = {
        schedule: schedule("ACTIVE"),
        coworkerOptions: [],
        projectOptions: [],
        canCreatePrivate: false,
      };
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <TaskScheduleActions {...props} />
        </QueryClientProvider>,
      );
      await user.click(screen.getByRole("button", { name: "more" }));
      await user.click(screen.getByRole("menuitem", { name: action }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();

      rerender(
        <QueryClientProvider client={queryClient}>
          <TaskScheduleActions
            {...props}
            schedule={{ ...props.schedule, canEditPlan: false }}
          />
        </QueryClientProvider>,
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
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
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("paused"),
    );
    expect(refreshMock).not.toHaveBeenCalled();
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
    ).toEqual([expect.stringMatching(/p_there$/)]);
    expect(loadMoreProjectsMock.mock.calls.map(([call]) => call)).toEqual([
      {
        cursor: null,
        query: undefined,
        state: "open",
        expectedOrganizationId: null,
        expectedViewerId: "user_1",
      },
      {
        cursor: "c1",
        query: undefined,
        state: "open",
        expectedOrganizationId: null,
        expectedViewerId: "user_1",
      },
      {
        cursor: null,
        query: undefined,
        state: "hidden",
        expectedOrganizationId: null,
        expectedViewerId: "user_1",
      },
    ]);
  });

  it("offers Show more only while a further page exists", async () => {
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_there")], null))
      .mockResolvedValueOnce(page([], null));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);

    expect(
      await screen.findByRole("option", { name: /p_there$/ }),
    ).toBeInTheDocument();
    await waitFor(() => expect(loadMoreProjectsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("option", { name: "copyToProjectLoadMore" }),
    ).toBeNull();
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
      expectedOrganizationId: null,
      expectedViewerId: "user_1",
    });
  });

  it("searches every Project by name on the server", async () => {
    loadMoreProjectsMock.mockImplementation(
      async ({ query, state }: { query?: string; state: string }) =>
        page(
          query === "old" && state === "open" ? [project("p_old")] : [],
          null,
        ),
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
      expectedOrganizationId: null,
      expectedViewerId: "user_1",
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

  it("blanks previous destination projects to loading while a new search loads", async () => {
    const searchPage = Promise.withResolvers<ReturnType<typeof page>>();
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_first")], null))
      .mockResolvedValueOnce(page([], null))
      .mockReturnValueOnce(searchPage.promise)
      .mockResolvedValueOnce(page([], null));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    expect(
      await screen.findByRole("option", { name: /p_first$/ }),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("combobox"), "old");

    expect(await screen.findByText("copyToProjectLoading")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /p_first$/ })).toBeNull();

    await act(async () => {
      searchPage.resolve(page([project("p_old")], null));
      await searchPage.promise;
    });

    expect(
      await screen.findByRole("option", { name: /p_old$/ }),
    ).toBeInTheDocument();
  });

  it("does not leave Show more stuck or overwrite results when a search interrupts an in-flight load-more", async () => {
    const staleLoadMore = Promise.withResolvers<ReturnType<typeof page>>();
    loadMoreProjectsMock.mockImplementation(
      async ({
        cursor,
        query,
        state,
      }: {
        cursor: string | null;
        query?: string;
        state: string;
      }) => {
        if (!query && state === "open" && cursor === null) {
          return page([project("p_first")], "c1");
        }
        if (!query && state === "open" && cursor === "c1") {
          return staleLoadMore.promise;
        }
        if (query === "old" && state === "open" && cursor === null) {
          return page([project("p_old_1")], "c2");
        }
        if (query === "old" && state === "open" && cursor === "c2") {
          return page([project("p_old_2")], null);
        }
        return page([], null);
      },
    );
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    await user.click(
      await screen.findByRole("option", { name: "copyToProjectLoadMore" }),
    );

    await user.type(screen.getByRole("combobox"), "old");
    expect(
      await screen.findByRole("option", { name: /p_old_1$/ }),
    ).toBeInTheDocument();

    await act(async () => {
      staleLoadMore.resolve(page([project("p_stale")], null));
      await staleLoadMore.promise;
    });

    expect(screen.queryByRole("option", { name: /p_stale$/ })).toBeNull();

    const loadMore = screen.getByRole("option", {
      name: "copyToProjectLoadMore",
    });
    expect(loadMore).not.toHaveAttribute("aria-disabled", "true");

    await user.click(loadMore);

    expect(
      await screen.findByRole("option", { name: /p_old_2$/ }),
    ).toBeInTheDocument();
  });

  it("isolates cached destination projects per workspaceId", async () => {
    const wsTwoLoad = Promise.withResolvers<ReturnType<typeof page>>();
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_ws_a")], null))
      .mockResolvedValueOnce(page([], null))
      .mockReturnValueOnce(wsTwoLoad.promise)
      .mockResolvedValueOnce(page([], null));
    const user = userEvent.setup();
    const { rerender } = renderCopyToProject({ workspaceId: "ws-a" });

    await openProjectPicker(user);
    expect(
      await screen.findByRole("option", { name: /p_ws_a$/ }),
    ).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <TaskScheduleActions
          schedule={{
            ...schedule("ACTIVE"),
            workspaceId: "ws-b",
            projectId: "p_here",
          }}
          coworkerOptions={[]}
          projectOptions={[]}
          canCreatePrivate={false}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("copyToProjectLoading")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /p_ws_a$/ })).toBeNull();

    await act(async () => {
      wsTwoLoad.resolve(page([project("p_ws_b")], null));
      await wsTwoLoad.promise;
    });

    expect(
      await screen.findByRole("option", { name: /p_ws_b$/ }),
    ).toBeInTheDocument();
  });

  it("keeps loaded projects visible when load-more fails and lets the user retry", async () => {
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_first")], "c1"))
      .mockRejectedValueOnce(new Error("page 2 failed"))
      .mockResolvedValueOnce(page([project("p_second")], null))
      .mockResolvedValueOnce(page([], null));
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    await user.click(
      await screen.findByRole("option", { name: "copyToProjectLoadMore" }),
    );

    expect(await screen.findByText("copyToProjectFailed")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /p_first$/ }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("option", { name: "copyToProjectLoadMore" }),
    );

    expect(
      await screen.findByRole("option", { name: /p_second$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("copyToProjectFailed")).toBeNull();
  });

  it("stops reading Hidden projects and caches nothing when closed before Open resolves", async () => {
    const openPage = Promise.withResolvers<ReturnType<typeof page>>();
    loadMoreProjectsMock.mockReturnValueOnce(openPage.promise);
    const user = userEvent.setup();
    renderCopyToProject({ workspaceId: "ws-a", organizationId: "org-a" });

    await openProjectPicker(user);
    await waitFor(() => expect(loadMoreProjectsMock).toHaveBeenCalledTimes(1));

    // Close while Open is still pending (simulating switching workspace right after).
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      openPage.resolve(
        page([project("p_open_a", { workspaceId: "ws-a" })], null),
      );
      await openPage.promise;
    });

    // Must never continue to Hidden in the new workspace or cache anything under A.
    expect(loadMoreProjectsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it("rejects destination projects returned from a different workspace", async () => {
    loadMoreProjectsMock.mockResolvedValueOnce(
      page([project("p_other_ws", { workspaceId: "ws-b" })], null),
    );
    const user = userEvent.setup();
    renderCopyToProject({ workspaceId: "ws-a", organizationId: "org-a" });

    await openProjectPicker(user);

    expect(await screen.findByText("copyToProjectFailed")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /p_other_ws$/ })).toBeNull();
  });

  it("starts each opening from a fresh first page and never offers stale projects when the fresh read fails", async () => {
    const reopenOpenPage = Promise.withResolvers<ReturnType<typeof page>>();
    loadMoreProjectsMock
      .mockResolvedValueOnce(page([project("p_old_1")], "c1"))
      .mockResolvedValueOnce(page([project("p_old_2")], null))
      .mockResolvedValueOnce(page([], null))
      .mockReturnValueOnce(reopenOpenPage.promise);
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    await user.click(
      await screen.findByRole("option", { name: "copyToProjectLoadMore" }),
    );
    expect(
      await screen.findByRole("option", { name: /p_old_2$/ }),
    ).toBeInTheDocument();

    // Close and reopen: previous opening's rows must not appear or stay selectable.
    await user.keyboard("{Escape}");
    await openProjectPicker(user);

    expect(await screen.findByText("copyToProjectLoading")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /p_old_1$/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /p_old_2$/ })).toBeNull();

    await act(async () => {
      reopenOpenPage.reject(new Error("reopen failed"));
      await reopenOpenPage.promise.catch(() => {});
    });

    expect(await screen.findByText("copyToProjectFailed")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /p_old_1$/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /p_old_2$/ })).toBeNull();
    expect(loadMoreProjectsMock).toHaveBeenCalledTimes(4);
  });

  it("resets the schedule project search immediately when cleared", async () => {
    loadMoreProjectsMock.mockImplementation(
      async ({ query, state }: { query?: string; state: string }) =>
        page(
          state !== "open"
            ? []
            : query === "old"
              ? [project("p_old")]
              : [project("p_all")],
          null,
        ),
    );
    const user = userEvent.setup();
    renderCopyToProject();

    await openProjectPicker(user);
    expect(
      await screen.findByRole("option", { name: /p_all$/ }),
    ).toBeInTheDocument();

    const input = screen.getByRole("combobox");
    await user.type(input, "old");
    expect(
      await screen.findByRole("option", { name: /p_old$/ }),
    ).toBeInTheDocument();

    loadMoreProjectsMock.mockClear();
    await user.clear(input);

    // Clearing must reset immediately (well under the 250 ms typing debounce).
    await waitFor(
      () =>
        expect(loadMoreProjectsMock).toHaveBeenCalledWith(
          expect.objectContaining({
            cursor: null,
            query: undefined,
            state: "open",
          }),
        ),
      { timeout: 100 },
    );
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
