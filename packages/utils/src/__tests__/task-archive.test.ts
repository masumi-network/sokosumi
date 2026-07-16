import { describe, expect, it } from "vitest";

import {
  canArchiveTaskStatus,
  getTaskCannotArchiveMessage,
  isGrantPendingTaskStatus,
  isTaskArchivableStatus,
  TASK_ARCHIVABLE_STATUSES,
} from "../task-archive.js";

describe("task-archive", () => {
  it.each(TASK_ARCHIVABLE_STATUSES)(
    "isTaskArchivableStatus returns true for %s",
    (status) => {
      expect(isTaskArchivableStatus(status)).toBe(true);
    },
  );

  it.each([
    "INPUT_REQUIRED",
    "AUTHENTICATION_REQUIRED",
    "OUT_OF_CREDITS",
    "CREDITS_TOPPED_UP",
    "RUNNING",
    "AWAITING_EXTERNAL",
    "APPROVAL_REQUIRED",
  ] as const)("isTaskArchivableStatus returns false for %s", (status) => {
    expect(isTaskArchivableStatus(status)).toBe(false);
  });

  it("treats GRANT_PENDING as archivable", () => {
    expect(isGrantPendingTaskStatus("GRANT_PENDING")).toBe(true);
    expect(canArchiveTaskStatus("GRANT_PENDING")).toBe(true);
    expect(canArchiveTaskStatus("APPROVAL_REQUIRED")).toBe(false);
  });

  it("lists every archivable status in TASK_ARCHIVABLE_STATUSES", () => {
    for (const status of TASK_ARCHIVABLE_STATUSES) {
      expect(isTaskArchivableStatus(status)).toBe(true);
    }
  });

  it("getTaskCannotArchiveMessage lists allowed statuses and the current one", () => {
    const message = getTaskCannotArchiveMessage("RUNNING");
    expect(message).toContain(TASK_ARCHIVABLE_STATUSES.join(", "));
    expect(message).toContain("Current status: RUNNING");
  });
});
