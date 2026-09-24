import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();
const loadTaskScheduleAssigneeOptionsMock = vi.fn();
const hasAssignedSeatMock = vi.fn();
const listSchedulesMock = vi.fn();
const taskSchedulesViewMock = vi.fn();

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("@/app/tasks/components/task-schedules-view", () => ({
  TaskSchedulesView: (props: unknown) => {
    taskSchedulesViewMock(props);
    return null;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: (projectId: string | null) =>
    getProjectFilterOptionsMock(projectId),
}));

vi.mock("@/app/tasks/utils/task-schedule-assignee-options", () => ({
  loadTaskScheduleAssigneeOptions: (organizationId: string | null) =>
    loadTaskScheduleAssigneeOptionsMock(organizationId),
}));

vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: {
    hasAssignedSeat: (organizationId: string | null) =>
      hasAssignedSeatMock(organizationId),
  },
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    listSchedules: (params: unknown) => listSchedulesMock(params),
  },
}));

import { SchedulesPageContent } from "./page";

const PROJECT = { id: "project-1", name: "Release planning" };
const SCHEDULE = { id: "schedule-1", name: "Weekly report" };

async function renderPage(searchParams: Record<string, string>) {
  render(
    await SchedulesPageContent({ searchParams: Promise.resolve(searchParams) }),
  );
  return taskSchedulesViewMock.mock.calls.at(-1)?.[0];
}

describe("SchedulesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
    });
    getProjectFilterOptionsMock.mockResolvedValue([PROJECT]);
    loadTaskScheduleAssigneeOptionsMock.mockResolvedValue({
      selectableOptions: [{ id: "cow-1", name: "Ops", kind: "coworker" }],
      displayOptions: [
        { id: "cow-1", name: "Ops", kind: "coworker" },
        { id: "user-1", name: "Maya", kind: "user" },
      ],
    });
    hasAssignedSeatMock.mockResolvedValue(true);
    listSchedulesMock.mockResolvedValue({
      schedules: [SCHEDULE],
      nextCursor: "cursor-2",
    });
  });

  it("lists the workspace's schedules by project and state", async () => {
    const props = await renderPage({
      projectId: PROJECT.id,
      scheduleState: "PAUSED",
    });

    expect(listSchedulesMock).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      state: "PAUSED",
      limit: 50,
    });
    expect(loadTaskScheduleAssigneeOptionsMock).toHaveBeenCalledWith("org-1");
    expect(props).toEqual(
      expect.objectContaining({
        schedules: [SCHEDULE],
        nextCursor: "cursor-2",
        coworkerOptions: [{ id: "cow-1", name: "Ops", kind: "coworker" }],
        assigneeDisplayOptions: [
          { id: "cow-1", name: "Ops", kind: "coworker" },
          { id: "user-1", name: "Maya", kind: "user" },
        ],
        projectOptions: [PROJECT],
        selectedProjectId: PROJECT.id,
        canCreate: true,
        canCreatePrivate: true,
      }),
    );
  });

  it("drops a project the viewer cannot see and an unknown state", async () => {
    const props = await renderPage({
      projectId: "project-gone",
      scheduleState: "SOMETIMES",
    });

    expect(listSchedulesMock).toHaveBeenCalledWith({
      projectId: null,
      state: null,
      limit: 50,
    });
    expect(props).toEqual(expect.objectContaining({ selectedProjectId: null }));
  });

  it("offers no create button without a Seat", async () => {
    hasAssignedSeatMock.mockResolvedValue(false);

    const props = await renderPage({});

    expect(hasAssignedSeatMock).toHaveBeenCalledWith("org-1");
    expect(props).toEqual(expect.objectContaining({ canCreate: false }));
  });
});
