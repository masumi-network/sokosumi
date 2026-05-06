import {
  AgentJobStatus,
  type JobEventWithRelations,
  type JobWithSokosumiStatus,
  SokosumiJobStatus,
} from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import JobDetailsOutputs from "@/components/jobs/job-details/outputs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/default-error-boundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div data-testid="expandable-markdown">{content}</div>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <div data-testid="separator" />,
}));

vi.mock("@/components/jobs/job-details/copy-markdown", () => ({
  default: () => <button type="button">copy</button>,
}));

vi.mock("@/components/jobs/job-details/download-button", () => ({
  default: () => <button type="button">download</button>,
}));

vi.mock("@/components/jobs/job-details/maximize-markdown", () => ({
  default: () => <button type="button">maximize</button>,
}));

vi.mock("@/components/jobs/job-details/hash-group-row", () => ({
  HashGroupRow: () => <div data-testid="hash-group-row" />,
}));

vi.mock("@/components/jobs/job-details/refund-request", () => ({
  canRenderRefundRequest: () => false,
  default: () => <button type="button">refund</button>,
}));

function createJob(): JobWithSokosumiStatus {
  return {
    id: "job-1",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: new Date("2026-03-26T10:06:00.000Z"),
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    taskId: null,
    name: "Shared Job",
    jobType: "FREE",
    status: SokosumiJobStatus.COMPLETED,
    credits: 0,
    cents: BigInt(0),
    onChainStatus: null,
    onChainTransactionHash: null,
    result: "final result",
    resultHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    agentJobId: "agent-job-1",
    identifierFromPurchaser: "purchase-id",
    blockchainIdentifier: null,
    payByTime: null,
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    sellerVkey: null,
    purchaseId: null,
    transactionId: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    task: null,
    purchase: null,
    transaction: null,
    jobScheduleId: null,
    jobSchedule: null,
    events: [],
    jobStatusSettled: false,
    user: {
      id: "user-1",
      name: "Ada Lovelace",
      image: null,
    },
    organization: null,
    agent: {
      id: "agent-1",
      name: "Research Agent",
      overrideName: null,
      icon: null,
      image: null,
      overrideImage: null,
      legalPrivacyPolicy: null,
      overrideLegalPrivacyPolicy: null,
      legalTerms: null,
      overrideLegalTerms: null,
      legalDpa: null,
      overrideLegalDpa: null,
      legalOther: null,
      overrideLegalOther: null,
    },
  } as unknown as JobWithSokosumiStatus;
}

function createEvent(): JobEventWithRelations {
  return {
    id: "event-1",
    createdAt: new Date("2026-03-26T10:06:00.000Z"),
    updatedAt: new Date("2026-03-26T10:06:00.000Z"),
    jobId: "job-1",
    status: AgentJobStatus.COMPLETED,
    result: "final result",
    transactionHash: null,
    log: null,
    postResultTransactionHash: null,
    fileLinks: [],
  } as unknown as JobEventWithRelations;
}

describe("JobDetailsOutputs", () => {
  it("does not render a second share control in the outputs toolbar", () => {
    render(
      <JobDetailsOutputs
        job={createJob()}
        event={createEvent()}
        readOnly={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "download" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "copy" })).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Components.Jobs.JobDetails.JobShare.share"),
    ).not.toBeInTheDocument();
  });
});
