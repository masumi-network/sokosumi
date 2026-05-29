import {
  JobType,
  type JobWithSokosumiStatus,
  SokosumiJobStatus,
} from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobMetaDetails } from "@/components/jobs/job-details/job-meta-details";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "Mar 27, 10:00 AM",
  }),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_NETWORK: "Testnet",
  }),
}));

vi.mock("@/components/copyable-value", () => ({
  CopyableValue: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: () => <span>status</span>,
}));

vi.mock("@/components/middle-truncate", () => ({
  MiddleTruncate: ({ text }: { text: string }) => <span>{text}</span>,
}));

function createJob(
  overrides: Partial<JobWithSokosumiStatus> = {},
): JobWithSokosumiStatus {
  return {
    id: "job-1",
    name: "Job name",
    createdAt: new Date("2026-03-27T10:00:00.000Z"),
    updatedAt: new Date("2026-03-27T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    agentJobId: "agent-job-1",
    blockchainIdentifier: null,
    identifierFromPurchaser: null,
    payByTime: null,
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    sellerVkey: null,
    transaction: null,
    transactionId: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    taskId: null,
    task: null,
    purchase: null,
    events: [],
    credits: 0,
    cents: BigInt(0),
    onChainStatus: null,
    onChainTransactionHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    result: null,
    resultHash: null,
    jobStatusSettled: false,
    user: {
      id: "user-1",
      name: "User",
      image: null,
    },
    organization: null,
    agent: {
      id: "agent-1",
      name: "Agent",
    },
    ...overrides,
  } as unknown as JobWithSokosumiStatus;
}

describe("JobMetaDetails", () => {
  it("shows credits from the job payload without requiring transaction data", () => {
    render(<JobMetaDetails job={createJob({ credits: 5 })} />);

    expect(screen.getByText("credits")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("hides the credits row when the job cost is zero", () => {
    render(<JobMetaDetails job={createJob({ credits: 0 })} />);

    expect(screen.queryByText("credits")).not.toBeInTheDocument();
  });
});
