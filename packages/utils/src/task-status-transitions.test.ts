import { describe, expect, it } from "vitest";

import {
  isAgentOnlyTaskStatus,
  userTaskStatusTransitionRequiresComment,
} from "./task-status-transitions.js";

describe("userTaskStatusTransitionRequiresComment", () => {
  it.each([
    ["COMPLETED", "READY"],
    ["CANCELED", "READY"],
  ] as const)("requires comment for %s → %s", (from, to) => {
    expect(userTaskStatusTransitionRequiresComment(from, to)).toBe(true);
  });

  it.each([
    ["READY", "DRAFT"],
    ["DRAFT", "READY"],
    ["COMPLETED", "RUNNING"],
    ["CANCELED", "RUNNING"],
    ["RUNNING", "COMPLETED"],
  ] as const)("does not require comment for %s → %s", (from, to) => {
    expect(userTaskStatusTransitionRequiresComment(from, to)).toBe(false);
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
