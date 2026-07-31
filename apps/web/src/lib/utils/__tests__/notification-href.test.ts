import { describe, expect, it } from "vitest";

import { getNotificationHref } from "@/lib/utils/notification-href";

describe("getNotificationHref", () => {
  it("links jobs to the agent job detail route when agentId is present", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: { agentId: "agent-1" },
      }),
    ).toBe("/agents/agent-1/jobs/job-1");
  });

  it("falls back to tasks when job agentId metadata is missing", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: null,
      }),
    ).toBe("/tasks");
  });

  it("links tasks to the task detail route", () => {
    expect(
      getNotificationHref({
        kind: "TASK",
        referenceId: "task-1",
        metadata: null,
      }),
    ).toBe("/tasks/task-1");
  });
});
