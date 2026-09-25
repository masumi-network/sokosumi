import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getScheduleMock = vi.fn();
const listUpcomingRunsMock = vi.fn();
const listTasksMock = vi.fn();
const getSessionMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();
const loadTaskScheduleAssigneeOptionsMock = vi.fn();
const projectScopeMarkerMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({
    dateTime: () => "date",
    number: (value: number) => String(value),
  }),
}));

vi.mock("@/app/components/project-scope/project-scope-marker", () => ({
  ProjectScopeMarker: (props: unknown) => {
    projectScopeMarkerMock(props);
    return null;
  },
}));

vi.mock("@/app/tasks/components/task-schedule-actions", () => ({
  TaskScheduleActions: () => null,
}));

vi.mock("@/app/tasks/components/task-schedule-state-badge", () => ({
  TaskScheduleStateBadge: () => null,
}));

vi.mock("@/app/tasks/utils/task-schedule-view", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/tasks/utils/task-schedule-view")
  >()),
  formatTaskScheduleRule: () => "rule",
}));

vi.mock("@/app/tasks/utils/task-schedule-assignee-options", () => ({
  loadTaskScheduleAssigneeOptions: (organizationId: string | null) =>
    loadTaskScheduleAssigneeOptionsMock(organizationId),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: (projectId: string | null) =>
    getProjectFilterOptionsMock(projectId),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTasks: (params: unknown) => listTasksMock(params),
  },
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    getSchedule: (scheduleId: string) => getScheduleMock(scheduleId),
    listUpcomingRuns: (scheduleId: string, params: unknown) =>
      listUpcomingRunsMock(scheduleId, params),
  },
}));

import TaskScheduleDetailPage from "./page";

const SCHEDULE = {
  id: "schedule-1",
  name: "Weekly report",
  description: null,
  ownerId: "user-owner",
  state: "ACTIVE",
  visibility: "WORKSPACE",
  nextRunAt: null,
  releasedCount: 0,
  rule: {
    timezone: "UTC",
    endsMode: "NEVER",
    endsOn: null,
    targetRunCount: null,
  },
};

/** The page wraps its async content in Suspense; render that content. */
async function renderPage() {
  const page = TaskScheduleDetailPage({
    params: Promise.resolve({ scheduleId: SCHEDULE.id }),
  });
  const content = page.props.children as ReactElement<object>;
  const Content = content.type as (props: object) => Promise<ReactNode>;
  render(await Content(content.props));
}

describe("TaskScheduleDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    loadTaskScheduleAssigneeOptionsMock.mockResolvedValue({
      selectableOptions: [],
      displayOptions: [],
    });
    getProjectFilterOptionsMock.mockResolvedValue([]);
    listUpcomingRunsMock.mockResolvedValue([]);
    listTasksMock.mockResolvedValue({ tasks: [] });
  });

  it("reports the schedule's project to the project switchers", async () => {
    getScheduleMock.mockResolvedValue({ ...SCHEDULE, projectId: "project-1" });

    await renderPage();

    expect(projectScopeMarkerMock).toHaveBeenCalledWith({
      projectId: "project-1",
    });
  });

  it("reports the workspace for a schedule with no project", async () => {
    getScheduleMock.mockResolvedValue({ ...SCHEDULE, projectId: null });

    await renderPage();

    expect(projectScopeMarkerMock).toHaveBeenCalledWith({ projectId: null });
  });
});
