import {
  JobType,
  type JobWithSokosumiStatus,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { JobRow } from "@/app/agents/[agentId]/jobs/components/jobs-list";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (_key: string) => "",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => children,
  useChannel: vi.fn(),
}));

vi.mock("@/contexts/alby-provider.dynamic", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../jobs-search", () => ({
  JobsSearch: () => null,
}));

vi.mock("../jobs-list.utils", () => ({
  buildJobDayGroups: () => [],
}));

function createJob(
  overrides: Partial<Omit<JobWithSokosumiStatus, "user">> & {
    user?: Partial<NonNullable<JobWithSokosumiStatus["user"]>> | null;
  },
): JobWithSokosumiStatus {
  return {
    id: "job-id",
    name: "Job name",
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
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

describe("JobRow", () => {
  it("does not render sharing badges for non-owned jobs", () => {
    const job = createJob({
      userId: "another-user",
      user: {
        id: "another-user",
        name: "Jane",
        image: "https://example.com/avatar.png",
      },
      share: {
        id: "share-1",
      } as never,
    });

    render(<JobRow job={job} selected={false} onClick={vi.fn()} />);

    expect(screen.queryByTestId("shared-job-avatar")).not.toBeInTheDocument();
  });

  it("does not render shared avatar for owned jobs", () => {
    const job = createJob({
      userId: "current-user",
      share: null,
    });

    render(<JobRow job={job} selected={false} onClick={vi.fn()} />);

    expect(screen.queryByTestId("shared-job-avatar")).not.toBeInTheDocument();
  });
});
