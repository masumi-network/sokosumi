import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  TaskSchedule,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskSchedulesView } from "./task-schedules-view";

const {
  changeTaskScheduleStateMock,
  loadMoreTaskSchedulesMock,
  projectSwitcherMock,
  replaceMock,
  searchParamsRef,
  scheduleDialogMock,
  loadWhenVisibleMock,
} = vi.hoisted(() => ({
  changeTaskScheduleStateMock: vi.fn().mockResolvedValue({ ok: true }),
  loadMoreTaskSchedulesMock: vi.fn(),
  projectSwitcherMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
  scheduleDialogMock: vi.fn(),
  loadWhenVisibleMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(", ")})` : key,
  useFormatter: () => ({ dateTime: () => "Mon, 9:00" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => "/schedules",
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("./tasks-project-switcher", () => ({
  TasksProjectSwitcher: (props: unknown) => {
    projectSwitcherMock(props);
    return null;
  },
}));

vi.mock("./task-schedule-dialog", () => ({
  TaskScheduleDialog: (props: unknown) => {
    scheduleDialogMock(props);
    return <div role="dialog" aria-label="schedule dialog" />;
  },
}));

vi.mock("@/lib/actions/task-schedule/action", () => ({
  changeTaskScheduleState: changeTaskScheduleStateMock,
  deleteTaskSchedule: vi.fn(),
}));

vi.mock("@/app/tasks/actions", () => ({
  loadMoreTaskSchedules: loadMoreTaskSchedulesMock,
}));

vi.mock("@/hooks/use-load-when-visible", () => ({
  useLoadWhenVisible: (
    _ref: unknown,
    options: { armed: boolean; boundaryKey: string; onVisible: () => void },
  ) => {
    loadWhenVisibleMock(options);
  },
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

const MEMBER: CoworkerOption = {
  ...ELENA,
  id: "user_2",
  slug: "maya",
  name: "Maya",
  kind: "user",
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

function renderView(
  schedules: TaskSchedule[],
  {
    nextCursor = null,
    projectId = null,
    state = null,
  }: {
    nextCursor?: string | null;
    projectId?: string | null;
    state?: TaskScheduleState | null;
  } = {},
) {
  return render(
    <TaskSchedulesView
      schedules={schedules}
      nextCursor={nextCursor}
      coworkerOptions={[ELENA]}
      assigneeDisplayOptions={[ELENA, MEMBER]}
      projectOptions={[]}
      selectedProjectId={projectId}
      selectedState={state}
      canCreate
      canCreatePrivate={false}
      currentUserId="user_1"
    />,
  );
}

describe("TaskSchedulesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams();
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
      "/schedules/01960001-0001-7001-8001-000000000001",
    );
    expect(weekly).toHaveTextContent("option.weeklyWithWeekdayTime");
    expect(weekly).toHaveTextContent("nextRun(Mon, 9:00)");
    expect(weekly).toHaveTextContent("state.ACTIVE");
    expect(weekly).toHaveTextContent("Elena");

    expect(paused).toHaveTextContent("state.PAUSED");
    expect(paused).toHaveTextContent("noNextRun");
    expect(paused).toHaveTextContent("unassigned");
  });

  it("switches layout without losing metadata, appended pages or actions and saves the preference", async () => {
    const user = userEvent.setup();
    loadMoreTaskSchedulesMock.mockResolvedValue({
      schedules: [schedule({ id: "second", name: "Second schedule" })],
      nextCursor: null,
    });
    renderView([schedule({})], { nextCursor: "next" });
    expect(screen.getByRole("radio", { name: "viewList" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "loadMore" }));
    await user.click(screen.getByRole("radio", { name: "viewGrid" }));
    expect(document.cookie).toContain("schedules_view_mode=grid");
    expect(screen.getByRole("list")).toHaveAttribute("data-view", "grid");
    expect(screen.getAllByTestId("schedule-row")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "edit" })).toHaveLength(2);
    expect(screen.getAllByTestId("schedule-row")[0]).toHaveTextContent(
      "nextRun(Mon, 9:00)",
    );
    await user.click(screen.getByRole("radio", { name: "viewList" }));
    expect(document.cookie).toContain("schedules_view_mode=list");
    expect(screen.getByRole("list")).toHaveAttribute("data-view", "list");
  });

  it("filters by state through the URL, keeping the other params", async () => {
    const user = userEvent.setup();
    renderView([schedule({})]);

    await user.click(screen.getByRole("tab", { name: "state.PAUSED" }));

    expect(replaceMock).toHaveBeenCalledWith("/schedules?scheduleState=PAUSED");
  });

  it("names a stored member without adding them to the create picker", async () => {
    const user = userEvent.setup();
    renderView([schedule({ assigneeId: null, assigneeUserId: MEMBER.id })]);

    expect(screen.getByRole("listitem")).toHaveTextContent("Maya");
    await user.click(screen.getByRole("button", { name: "newSchedule" }));

    expect(scheduleDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ coworkerOptions: [ELENA] }),
    );
  });

  it("clears the state filter", async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams("scheduleState=ENDED");
    renderView([], { state: "ENDED" });

    expect(screen.getByRole("tab", { name: "state.ENDED" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "filterAll" }));

    expect(replaceMock).toHaveBeenCalledWith("/schedules");
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

  it("loads more of the same project and state", async () => {
    const user = userEvent.setup();
    const projectId = "33333333-3333-4333-8333-333333333333";
    searchParamsRef.current = new URLSearchParams(
      `projectId=${projectId}&scheduleState=PAUSED`,
    );
    loadMoreTaskSchedulesMock.mockResolvedValue({
      schedules: [
        schedule({
          id: "01960001-0001-7001-8001-000000000009",
          name: "Older schedule",
        }),
      ],
      nextCursor: null,
    });
    renderView([schedule({})], {
      nextCursor: "cursor-1",
      projectId,
      state: "PAUSED",
    });

    await user.click(screen.getByRole("button", { name: "loadMore" }));

    expect(loadMoreTaskSchedulesMock).toHaveBeenCalledWith({
      cursor: "cursor-1",
      projectId,
      state: "PAUSED",
    });
    expect(
      await screen.findByRole("link", { name: /Older schedule/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "loadMore" })).toBeNull();
  });

  it("reloads appended pages after changing a schedule", async () => {
    const user = userEvent.setup();
    const older = schedule({
      id: "older",
      name: "Older schedule",
      state: "ACTIVE",
    });
    loadMoreTaskSchedulesMock.mockResolvedValue({
      schedules: [older],
      nextCursor: null,
    });
    renderView([schedule({})], { nextCursor: "cursor-1" });
    await user.click(screen.getByRole("button", { name: "loadMore" }));
    const link = await screen.findByRole("link", { name: "Older schedule" });
    const row = link.closest("li");
    if (!row) throw new Error("Missing schedule row");
    await user.click(within(row).getByRole("button", { name: "pause" }));
    expect(changeTaskScheduleStateMock).toHaveBeenCalledWith({
      scheduleId: "older",
      action: "pause",
    });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Older schedule" })).toBeNull(),
    );
    loadMoreTaskSchedulesMock.mockResolvedValue({
      schedules: [{ ...older, state: "PAUSED" }],
      nextCursor: null,
    });
    await user.click(screen.getByRole("button", { name: "loadMore" }));
    const refreshed = (
      await screen.findByRole("link", { name: "Older schedule" })
    ).closest("li");
    if (!refreshed) throw new Error("Missing refreshed row");
    expect(
      within(refreshed).getByRole("button", { name: "resume" }),
    ).toBeInTheDocument();
  });

  it("uses the refreshed first-page cursor after invalidating appended pages", async () => {
    const user = userEvent.setup();
    const initial = [schedule({})];
    const view = renderView(initial, { nextCursor: "old-cursor" });
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "pause" }));
    });
    view.rerender(
      <TaskSchedulesView
        schedules={initial}
        nextCursor="new-cursor"
        coworkerOptions={[ELENA]}
        assigneeDisplayOptions={[ELENA, MEMBER]}
        projectOptions={[]}
        selectedProjectId={null}
        selectedState={null}
        canCreate
        canCreatePrivate={false}
        currentUserId="user_1"
      />,
    );
    loadMoreTaskSchedulesMock.mockResolvedValue({
      schedules: [],
      nextCursor: null,
    });
    await user.click(screen.getByRole("button", { name: "loadMore" }));
    expect(loadMoreTaskSchedulesMock).toHaveBeenCalledWith({
      cursor: "new-cursor",
      projectId: null,
      state: null,
    });
  });

  it("asks for the next page as the end of the list comes into view", async () => {
    loadMoreTaskSchedulesMock.mockResolvedValue({
      schedules: [
        schedule({
          id: "01960001-0001-7001-8001-000000000009",
          name: "Older schedule",
        }),
      ],
      nextCursor: null,
    });
    renderView([schedule({})], { nextCursor: "cursor-1" });

    const armed = loadWhenVisibleMock.mock.calls.at(-1)?.[0];
    expect(armed).toEqual(
      expect.objectContaining({
        armed: true,
        boundaryKey: "01960001-0001-7001-8001-000000000001",
      }),
    );

    armed.onVisible();

    expect(
      await screen.findByRole("link", { name: /Older schedule/ }),
    ).toBeInTheDocument();
  });

  it("stops asking on its own once a page fails, and keeps a retry", async () => {
    const user = userEvent.setup();
    loadMoreTaskSchedulesMock.mockRejectedValue(new Error("nope"));
    renderView([schedule({})], { nextCursor: "cursor-1" });

    await user.click(screen.getByRole("button", { name: "loadMore" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("loadMoreError");
    expect(loadWhenVisibleMock.mock.calls.at(-1)?.[0].armed).toBe(false);
  });

  it("scopes the project switcher to the selected project", () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    renderView([], { projectId });

    expect(projectSwitcherMock).toHaveBeenCalledWith(
      expect.objectContaining({ selectedProjectId: projectId }),
    );
  });
});
