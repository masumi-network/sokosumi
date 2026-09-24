import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  TaskSchedule,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskSchedulesView } from "./task-schedules-view";

const {
  loadMoreTaskSchedulesMock,
  projectSwitcherMock,
  replaceMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  loadMoreTaskSchedulesMock: vi.fn(),
  projectSwitcherMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
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
  TaskScheduleDialog: () => <div role="dialog" aria-label="schedule dialog" />,
}));

vi.mock("@/app/tasks/actions", () => ({
  loadMoreTaskSchedules: loadMoreTaskSchedulesMock,
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
      projectOptions={[]}
      selectedProjectId={projectId}
      selectedState={state}
      canCreate
      canCreatePrivate={false}
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

  it("filters by state through the URL, keeping the other params", async () => {
    const user = userEvent.setup();
    renderView([schedule({})]);

    await user.click(screen.getByRole("radio", { name: "state.PAUSED" }));

    expect(replaceMock).toHaveBeenCalledWith("/schedules?scheduleState=PAUSED");
  });

  it("clears the state filter", async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams("scheduleState=ENDED");
    renderView([], { state: "ENDED" });

    expect(screen.getByRole("radio", { name: "state.ENDED" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "filterAll" }));

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

  it("scopes the project switcher to the selected project", () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    renderView([], { projectId });

    expect(projectSwitcherMock).toHaveBeenCalledWith(
      expect.objectContaining({ selectedProjectId: projectId }),
    );
  });
});
