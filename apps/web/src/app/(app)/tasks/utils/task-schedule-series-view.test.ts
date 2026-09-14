import { describe, expect, it } from "vitest";

import { buildTaskScheduleSeriesView } from "@/app/tasks/utils/task-schedule-series-view";

const RECURRING_V2 = JSON.stringify({
  version: 2,
  epochId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-09-01T07:00:00.000Z",
  ruleEffectiveFrom: "2026-09-01T07:00:00.000Z",
  timezone: "Europe/Berlin",
  mode: "recurring",
  expr: "0 9 * * *",
  endsMode: "never",
  epochReleaseCount: 3,
  anchorAt: "2026-09-01T07:00:00.000Z",
});

const ONCE_V1 = JSON.stringify({
  version: 1,
  scheduledAt: "2026-09-01T07:00:00.000Z",
  mode: "once",
  runAt: "2026-09-10T07:00:00.000Z",
});

function build(
  overrides: Partial<Parameters<typeof buildTaskScheduleSeriesView>[0]> = {},
) {
  return buildTaskScheduleSeriesView({
    metadata: RECURRING_V2,
    nextRunAt: new Date("2026-09-10T07:00:00.000Z"),
    scheduleRevision: 4,
    project: null,
    workspaceName: "Acme Corp",
    ...overrides,
  });
}

describe("buildTaskScheduleSeriesView", () => {
  it("shows an active series", () => {
    expect(build()?.isActive).toBe(true);
  });

  it("still shows a removed series that kept its revision", () => {
    const view = build({
      metadata: null,
      nextRunAt: null,
      scheduleRevision: 7,
    });

    expect(view).not.toBeNull();
    expect(view?.isActive).toBe(false);
    expect(view?.rule).toBeNull();
    expect(view?.timezone).toBeNull();
  });

  it("hides the section for a Task that never carried a schedule", () => {
    expect(
      build({ metadata: null, nextRunAt: null, scheduleRevision: 0 }),
    ).toBeNull();
    expect(
      build({ metadata: null, nextRunAt: null, scheduleRevision: undefined }),
    ).toBeNull();
  });

  it("points a workspace series at the workspace Calendar", () => {
    expect(build()?.calendar).toEqual({
      name: "Acme Corp",
      href: "/calendar",
      source: "WORKSPACE",
    });
  });

  it("points a project series at the Project Calendar", () => {
    expect(
      build({ project: { id: "project_1", name: "Q3 launch" } })?.calendar,
    ).toEqual({
      name: "Q3 launch",
      href: "/projects/project_1/calendar",
      source: "PROJECT",
    });
  });

  it("passes the recurring rule and its captured time zone to the title formatter", () => {
    const view = build();

    expect(view?.timezone).toBe("Europe/Berlin");
    expect(view?.rule).toEqual({
      scheduleType: "CRON",
      cron: "0 9 * * *",
      timezone: "Europe/Berlin",
    });
  });

  it("reports no captured time zone for a legacy one-time rule", () => {
    const view = build({ metadata: ONCE_V1 });

    expect(view?.timezone).toBeNull();
    expect(view?.rule).toEqual({
      scheduleType: "ONE_TIME",
      cron: null,
      timezone: "UTC",
    });
  });
});
