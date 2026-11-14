import { randomUUID } from "node:crypto";
import { TaskScheduleState, TaskVisibility } from "@sokosumi/database";
import { beforeEach, describe, expect, it } from "vitest";

import {
  parseSeoMonitorPlan,
  SEO_MONITOR_MARKER,
} from "@/lib/seo/monitor-plan";
import { taskScheduleSchema } from "@/schemas/task-schedule.schema";
import {
  OWNER_ID,
  PROJECT_ID,
  resetTaskScheduleTestDb,
  seedTaskSchedule,
} from "@/test-fixtures/task-schedule";

import {
  mapTaskSchedule,
  type ScheduleWithAssigneeVendor,
  toTaskScheduleView,
} from "./task-schedule-read.service";

const PAGE_ID = "22222222-2222-4222-8222-222222222222";
function schedule(
  overrides: Parameters<typeof seedTaskSchedule>[0] = {},
): ScheduleWithAssigneeVendor {
  return {
    ...seedTaskSchedule(overrides),
    assignee: null,
    creatorUser: { id: OWNER_ID, name: "Owner", image: null },
    creatorCoworker: null,
    creatorSokoBot: null,
  };
}
function monitorDescription() {
  return (
    SEO_MONITOR_MARKER +
    JSON.stringify({
      version: 1,
      cadence: "weekly",
      timeZone: "Europe/Oslo",
      targetRunCount: 4,
      scopeVersion: 2,
      analysis: {
        kind: "rankings",
        pageIds: [PAGE_ID],
        keywords: ["agent payments"],
        countryCode: "US",
        languageCode: "en",
        devices: ["mobile"],
        maxProviderCalls: 1,
        idempotencyKey: "monitor-template",
        coworkerId: "coworker",
      },
    })
  );
}
const owner = { kind: "user" as const, userId: OWNER_ID };
beforeEach(() => resetTaskScheduleTestDb());

describe("Task Schedule read projection", () => {
  it("preserves generic Active and Paused manual runs and plan edits, with their original description", () => {
    for (const state of [TaskScheduleState.ACTIVE, TaskScheduleState.PAUSED]) {
      const mapped = taskScheduleSchema.parse(
        mapTaskSchedule(
          toTaskScheduleView(
            owner,
            schedule({ state, description: "Review weekly statistics" }),
          ),
        ),
      );
      expect(mapped).toMatchObject({
        canWrite: true,
        canRunNow: true,
        canEditPlan: true,
        description: "Review weekly statistics",
      });
    }
    expect(
      mapTaskSchedule(
        toTaskScheduleView(owner, schedule({ state: TaskScheduleState.ENDED })),
      ),
    ).toMatchObject({ canWrite: true, canRunNow: false, canEditPlan: false });
  });
  it("lets a monitor run now but keeps its plan edit in the SEO workspace and hides the raw protocol", () => {
    const raw = schedule({
      description: monitorDescription(),
      projectId: PROJECT_ID,
    });
    const projected = mapTaskSchedule(toTaskScheduleView(owner, raw));
    expect(projected.canRunNow).toBe(true);
    expect(projected.canEditPlan).toBe(false);
    // Another member may write the public monitor but not add a Run billed to its owner.
    const member = { kind: "user" as const, userId: randomUUID() };
    expect(mapTaskSchedule(toTaskScheduleView(member, raw))).toMatchObject({
      canWrite: true,
      canRunNow: false,
    });
    const mapped = taskScheduleSchema.parse(projected);
    expect(mapped).toMatchObject({
      canWrite: true,
      canRunNow: true,
      canEditPlan: false,
      description:
        "Weekly ranking checks for 1 saved page. Ends after 4 scheduled runs. Time zone: Europe/Oslo.",
      seoMonitor: { kind: "rankings", pageCount: 1 },
    });
    expect(mapped.description).not.toContain(SEO_MONITOR_MARKER);
    expect(mapped.description).not.toContain(PAGE_ID);
    expect(raw.description).toContain(SEO_MONITOR_MARKER);
    expect(parseSeoMonitorPlan(raw.description)?.analysis.pageIds).toEqual([
      PAGE_ID,
    ]);
  });
  it("keeps malformed reserved monitor packets closed without hiding ordinary prose", () => {
    const malformed = mapTaskSchedule(
      toTaskScheduleView(
        owner,
        schedule({ description: SEO_MONITOR_MARKER + "{broken" }),
      ),
    );
    expect(malformed).toMatchObject({
      canRunNow: false,
      canEditPlan: false,
      description:
        "SEO monitor. Review its saved plan before the next scheduled run.",
      seoMonitor: null,
    });
    const prose = "Please explain the seo_monitor: format";
    expect(
      mapTaskSchedule(
        toTaskScheduleView(owner, schedule({ description: prose })),
      ),
    ).toMatchObject({ canRunNow: true, canEditPlan: true, description: prose });
  });
  it("does not grant operation capabilities to a non-owner of a private schedule", () => {
    const reader = { kind: "user" as const, userId: "other-member" };
    expect(
      mapTaskSchedule(
        toTaskScheduleView(
          reader,
          schedule({ visibility: TaskVisibility.PRIVATE }),
        ),
      ),
    ).toMatchObject({ canWrite: false, canRunNow: false, canEditPlan: false });
  });
});
