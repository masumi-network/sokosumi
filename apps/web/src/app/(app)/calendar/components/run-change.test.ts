import type {
  SocialPostCalendarItem,
  WorkspaceCalendarItem,
} from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { isChangeableRun, runChangeErrorKey } from "./run-change";

function run(
  overrides: Partial<WorkspaceCalendarItem> = {},
): WorkspaceCalendarItem {
  return {
    kind: "RUN",
    id: "run-1",
    scheduleId: "sched-1",
    scheduleRevision: 1,
    canChangeRun: true,
    taskId: "task-1",
    taskName: "Daily",
    taskStatus: "QUEUED",
    taskAssigneeId: null,
    taskOwnerId: "user-1",
    scheduledAt: new Date("2026-10-11T12:00:00.000Z"),
    originalScheduledAt: null,
    state: "PLANNED",
    sourceId: "workspace:ws-1",
    sourceWorkspaceId: "ws-1",
    sourceType: "WORKSPACE",
    sourceProjectId: null,
    ...overrides,
  };
}

const socialPost: SocialPostCalendarItem = {
  kind: "socialPost",
  revision: 4,
  id: "social:post-1",
  postId: "post-1",
  provider: "x",
  text: "Launch",
  status: "SCHEDULED",
  externalHandle: "team",
  avatarUrl: null,
  projectName: "Launch",
  creator: { kind: "user", id: "user-1", name: "Albina" },
  scheduledByName: "Albina",
  scheduledByImage: null,
  attachmentCount: 0,
  previewMedia: null,
  scheduledAt: new Date("2026-10-11T12:00:00.000Z"),
  lastAttempt: null,
  sourceId: "project:p-1",
  sourceWorkspaceId: "ws-1",
  sourceType: "PROJECT",
  sourceProjectId: "p-1",
};

describe("isChangeableRun", () => {
  it("allows a Task Schedule Run the viewer may move", () => {
    expect(isChangeableRun(run())).toBe(true);
  });

  it("refuses a Social post even when it sits on the same calendar", () => {
    expect(isChangeableRun(socialPost)).toBe(false);
  });

  it("refuses a Run the viewer cannot change or one without a schedule", () => {
    expect(isChangeableRun(run({ canChangeRun: false }))).toBe(false);
    expect(isChangeableRun(run({ scheduleId: null }))).toBe(false);
    expect(isChangeableRun(run({ scheduleRevision: null }))).toBe(false);
  });
});

describe("runChangeErrorKey", () => {
  it("maps each Core refusal to an App.Calendar message", () => {
    expect(runChangeErrorKey("stale")).toBe("event.runStale");
    expect(runChangeErrorKey("invalid_time")).toBe("event.runInvalidTime");
    expect(runChangeErrorKey("failed")).toBe("event.runError");
  });
});
