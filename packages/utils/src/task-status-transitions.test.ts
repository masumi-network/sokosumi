import { describe, expect, it } from "vitest";

import {
  isAgentOnlyTaskStatus,
  userTaskStatusTransitionRequiresComment,
} from "./task-status-transitions.js";

describe("userTaskStatusTransitionRequiresComment", () => {
  it.each([
    ["COMPLETED", "READY"],
    ["CANCELED", "READY"],
    ["INPUT_REQUIRED", "READY"],
  ] as const)(
    "requires comment for %s → %s with an agent assignee",
    (from, to) => {
      expect(userTaskStatusTransitionRequiresComment(from, to, true)).toBe(
        true,
      );
    },
  );

  it.each([
    ["COMPLETED", "READY"],
    ["CANCELED", "READY"],
  ] as const)(
    "reopens %s → %s without a comment for a person's Task",
    (from, to) => {
      expect(userTaskStatusTransitionRequiresComment(from, to, false)).toBe(
        false,
      );
    },
  );

  it.each([
    ["READY", "DRAFT"],
    ["DRAFT", "READY"],
    ["COMPLETED", "RUNNING"],
    ["CANCELED", "DRAFT"],
    ["RUNNING", "COMPLETED"],
  ] as const)("does not require comment for %s → %s", (from, to) => {
    expect(userTaskStatusTransitionRequiresComment(from, to, true)).toBe(false);
  });
});

describe("isAgentOnlyTaskStatus", () => {
  it.each([
    "QUEUED",
    "GRANT_PENDING",
    "INPUT_REQUIRED",
    "APPROVAL_REQUIRED",
    "AUTHENTICATION_REQUIRED",
    "OUT_OF_CREDITS",
    "CREDITS_TOPPED_UP",
    "FAILED",
  ])("treats %s as agent-only", (status) => {
    expect(isAgentOnlyTaskStatus(status)).toBe(true);
  });

  it.each([
    "DRAFT",
    "READY",
    "RUNNING",
    "AWAITING_EXTERNAL",
    "COMPLETED",
    "CANCELED",
  ])("treats %s as not agent-only", (status) => {
    expect(isAgentOnlyTaskStatus(status)).toBe(false);
  });
});
