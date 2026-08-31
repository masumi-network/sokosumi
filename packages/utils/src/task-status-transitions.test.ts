import { describe, expect, it } from "vitest";

import {
  canUserTransitionTaskStatus,
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

  it("rejects READY → RUNNING while a coworker is assigned", () => {
    expect(canUserTransitionTaskStatus("READY", "RUNNING")).toBe(false);
    expect(canUserTransitionTaskStatus("READY", "RUNNING", "coworker")).toBe(
      false,
    );
  });

  it.each([
    ["READY", "RUNNING"],
    ["RUNNING", "READY"],
    ["RUNNING", "AWAITING_EXTERNAL"],
    ["RUNNING", "COMPLETED"],
    ["AWAITING_EXTERNAL", "READY"],
    ["AWAITING_EXTERNAL", "COMPLETED"],
  ] as const)("accepts human/unset %s → %s", (from, to) => {
    expect(canUserTransitionTaskStatus(from, to, "human")).toBe(true);
    expect(canUserTransitionTaskStatus(from, to, "unset")).toBe(true);
  });

  it("rejects human READY → COMPLETED", () => {
    expect(canUserTransitionTaskStatus("READY", "COMPLETED", "human")).toBe(
      false,
    );
  });

  it("rejects human READY → QUEUED", () => {
    expect(canUserTransitionTaskStatus("READY", "QUEUED", "human")).toBe(false);
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
