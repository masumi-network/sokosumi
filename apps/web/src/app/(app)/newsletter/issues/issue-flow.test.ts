import type { NewsletterIssue } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { NEWSLETTER_ISSUE } from "@/test/newsletter";
import { getIssueStage, getStepIndex, type IssueStage } from "./issue-flow";

const APPROVED = {
  approvedAt: new Date("2026-10-23T10:00:00Z"),
  approvedByUserId: "user_1",
};

describe("newsletter issue flow", () => {
  it.each([
    [{}, false, "review", 1],
    [{}, true, "write", 0],
    [{ content: [] }, false, "write", 0],
    [{ status: "NEEDS_APPROVAL" }, false, "approve", 2],
    [{ status: "NEEDS_APPROVAL", ...APPROVED }, false, "send", 3],
    [{ status: "SCHEDULED", ...APPROVED }, false, "scheduled", 3],
    [{ status: "SENDING" }, false, "sending", 3],
    [{ status: "FAILED" }, false, "failed", 3],
    [{ status: "SENT" }, false, "sent", 4],
    [{ status: "CANCELED" }, false, "canceled", -1],
  ] satisfies [Partial<NewsletterIssue>, boolean, IssueStage, number][])(
    "maps %j (unsaved %s) to %s",
    (patch, unsaved, stage, index) => {
      const result = getIssueStage({ ...NEWSLETTER_ISSUE, ...patch }, unsaved);
      expect(result).toBe(stage);
      expect(getStepIndex(result)).toBe(index);
    },
  );
});
