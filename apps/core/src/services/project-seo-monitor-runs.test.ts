import { describe, expect, it } from "vitest";

import { lastRunStatus } from "./project-seo-monitor-runs";

describe("SEO monitor last run status", () => {
  it.each(["RUNNING", "COMPLETED"])(
    "shows a %s Task as running until its requested analysis is imported",
    (taskStatus) => {
      expect(lastRunStatus(taskStatus, "requested")).toBe("running");
    },
  );

  it("reads a Task that failed without a result as failed, not as still requested", () => {
    expect(lastRunStatus("FAILED", "requested")).toBe("failed");
    expect(lastRunStatus("CANCELED", "running")).toBe("failed");
  });

  it("lets a finished analysis decide over the Task", () => {
    expect(lastRunStatus("FAILED", "completed")).toBe("completed");
    expect(lastRunStatus("COMPLETED", "failed")).toBe("failed");
  });

  it("keeps a waiting analysis while its Task is open", () => {
    expect(lastRunStatus("READY", "requested")).toBe("requested");
    expect(lastRunStatus("IN_PROGRESS", undefined)).toBe("running");
    expect(lastRunStatus("COMPLETED", undefined)).toBe("completed");
  });
});
