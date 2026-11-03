import type { NewsletterIssue } from "@sokosumi/core-client";

/** The four steps the issue page walks through. Labels only: Core owns the status. */
export const ISSUE_STEPS = ["write", "review", "approve", "send"] as const;
export type IssueStep = (typeof ISSUE_STEPS)[number];

/** Where an issue sits in the flow, read from its existing status and approval. */
export type IssueStage =
  | IssueStep
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "canceled";

export function getIssueStage(
  issue: NewsletterIssue,
  unsaved: boolean,
): IssueStage {
  switch (issue.status) {
    case "DRAFT":
      return unsaved || !issue.content.length ? "write" : "review";
    case "NEEDS_APPROVAL":
      return issue.approvedAt && issue.approvedByUserId ? "send" : "approve";
    case "SCHEDULED":
      return "scheduled";
    case "SENDING":
      return "sending";
    case "SENT":
      return "sent";
    case "FAILED":
      return "failed";
    default:
      return "canceled";
  }
}

/** Index of the current step; `ISSUE_STEPS.length` once sent, -1 when off the flow. */
export function getStepIndex(stage: IssueStage) {
  if (stage === "sent") return ISSUE_STEPS.length;
  if (stage === "canceled") return -1;
  const step = ISSUE_STEPS.indexOf(stage as IssueStep);
  return step === -1 ? ISSUE_STEPS.indexOf("send") : step;
}
