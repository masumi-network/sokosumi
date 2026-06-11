import { SokosumiJobStatus } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobMetaDetails } from "@/components/jobs/job-details/job-meta-details";
import type { Job } from "@/lib/clients/generated/core";

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

function createJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    name: "Job name",
    createdAt: new Date("2026-03-27T10:00:00.000Z"),
    updatedAt: new Date("2026-03-27T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: "FREE",
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    organization: null,
    projectId: null,
    taskId: null,
    agentJobId: "agent-job-1",
    identifierFromPurchaser: null,
    share: null,
    events: [],
    credits: 0,
    onChainStatus: null,
    onChainTransactionHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    result: null,
    resultHash: null,
    user: {
      id: "user-1",
      name: "User",
      image: null,
    },
    workspace: {
      id: "workspace-1",
      organizationId: null,
      organization: null,
    },
    agent: {
      id: "agent-1",
      name: "Agent",
    },
    ...overrides,
  };
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
