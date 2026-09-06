import { describe, expect, it } from "vitest";

import {
  canUserTransitionTaskStatus,
  isAgentOnlyTaskStatus,
  userTaskStatusTransitionRequiresComment,
} from "./task-status-transitions.js";

describe("canUserTransitionTaskStatus", () => {
  it("rejects same-status transitions", () => {
    expect(canUserTransitionTaskStatus("READY", "READY")).toBe(false);
  });

  it.each([
    ["DRAFT", "QUEUED"],
    ["QUEUED", "READY"],
    ["QUEUED", "CANCELED"],
    ["READY", "QUEUED"],
    ["RUNNING", "CANCELED"],
    ["AWAITING_EXTERNAL", "CANCELED"],
    ["INPUT_REQUIRED", "CANCELED"],
    ["APPROVAL_REQUIRED", "CANCELED"],
    ["AUTHENTICATION_REQUIRED", "CANCELED"],
    ["OUT_OF_CREDITS", "CANCELED"],
    ["CREDITS_TOPPED_UP", "CANCELED"],
    ["COMPLETED", "READY"],
    ["CANCELED", "READY"],
  ] as const)("accepts %s → %s", (from, to) => {
    expect(canUserTransitionTaskStatus(from, to)).toBe(true);
  });

  it.each([
    ["COMPLETED", "DRAFT"],
    ["FAILED", "DRAFT"],
    ["FAILED", "READY"],
    ["CANCELED", "DRAFT"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(canUserTransitionTaskStatus(from, to)).toBe(false);
  });

  it("rejects CREDITS_TOPPED_UP → QUEUED (scheduled column drag)", () => {
    expect(canUserTransitionTaskStatus("CREDITS_TOPPED_UP", "QUEUED")).toBe(
      false,
    );
  });

  it.each([
    ["READY", "RUNNING"],
    ["RUNNING", "READY"],
    ["RUNNING", "AWAITING_EXTERNAL"],
    ["RUNNING", "COMPLETED"],
    ["AWAITING_EXTERNAL", "RUNNING"],
    ["AWAITING_EXTERNAL", "READY"],
    ["AWAITING_EXTERNAL", "COMPLETED"],
  ] as const)("accepts human %s → %s", (from, to) => {
    expect(canUserTransitionTaskStatus(from, to, "human")).toBe(true);
    expect(canUserTransitionTaskStatus(from, to, "unset")).toBe(true);
  });

  it.each([
    ["READY", "COMPLETED"],
    ["READY", "QUEUED"],
    ["DRAFT", "QUEUED"],
    ["RUNNING", "FAILED"],
    ["AWAITING_EXTERNAL", "FAILED"],
  ] as const)("rejects human %s → %s", (from, to) => {
    expect(canUserTransitionTaskStatus(from, to, "human")).toBe(false);
  });

  it("keeps agent RUNNING → CANCELED only for coworker tasks", () => {
    expect(canUserTransitionTaskStatus("RUNNING", "COMPLETED")).toBe(false);
    expect(canUserTransitionTaskStatus("RUNNING", "COMPLETED", "human")).toBe(
      true,
    );
  });
});

describe("userTaskStatusTransitionRequiresComment", () => {
  it.each([
    ["CANCELED", "READY"],
    ["COMPLETED", "READY"],
  ] as const)("requires comment for %s → %s", (from, to) => {
    expect(userTaskStatusTransitionRequiresComment(from, to)).toBe(true);
  });

  it.each([
    ["DRAFT", "READY"],
    ["READY", "DRAFT"],
    ["CANCELED", "RUNNING"],
    ["FAILED", "READY"],
  ] as const)("does not require comment for %s → %s", (from, to) => {
    expect(userTaskStatusTransitionRequiresComment(from, to)).toBe(false);
  });
});

describe("isAgentOnlyTaskStatus", () => {
  it.each(["QUEUED", "GRANT_PENDING", "FAILED"] as const)(
    "marks %s agent-only",
    (status) => {
      expect(isAgentOnlyTaskStatus(status)).toBe(true);
    },
  );

  it.each(["DRAFT", "READY", "RUNNING", "CANCELED"] as const)(
    "allows %s without an agent assignee",
    (status) => {
      expect(isAgentOnlyTaskStatus(status)).toBe(false);
    },
  );
});
