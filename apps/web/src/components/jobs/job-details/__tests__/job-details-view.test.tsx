import { JobWithSokosumiStatus, SokosumiJobStatus } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import JobDetailsView from "@/components/jobs/job-details/job-details-view";

const useSessionMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: (...args: unknown[]) => useSessionMock(...args),
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
  JobErrorCode: {
    JOB_NOT_FOUND: "JOB_NOT_FOUND",
  },
  updateJobName: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueryClient: vi.fn(),
}));

vi.mock("@/app/agents/[agentId]/jobs/components/header", () => ({
  default: () => <div data-testid="jobs-header" />,
}));

vi.mock("@/app/agents/[agentId]/jobs/components/jobs-header-context", () => ({
  useJobsHeader: () => null,
}));

vi.mock("@/lib/helpers/agent", () => ({
  getAgentLegal: () => [],
  getAgentName: () => "Research Agent",
}));

vi.mock("@/components/jobs/job-details/job-details-name", () => ({
  default: ({ job }: { job: { id: string } }) => (
    <div data-testid="job-details-name">{job.id}</div>
  ),
}));

vi.mock("@/components/jobs/job-details/job-meta-details", () => ({
  JobMetaDetails: ({ job }: { job: { id: string } }) => (
    <div data-testid="job-meta-details">{job.id}</div>
  ),
}));

vi.mock("@/components/jobs/job-details/job-details-footer", () => ({
  JobDetailsFooter: () => <div data-testid="job-details-footer" />,
}));

vi.mock("@/components/jobs/job-details/inputs", () => ({
  default: () => <div data-testid="job-details-inputs" />,
}));

vi.mock("@/components/jobs/job-details/outputs", () => ({
  default: () => <div data-testid="job-details-outputs" />,
}));

vi.mock("@/components/jobs/job-details/provide-input", () => ({
  default: () => <div data-testid="job-details-provide-input" />,
}));

vi.mock("@/components/jobs/job-details/sources", () => ({
  default: () => <div data-testid="job-details-sources" />,
}));

function createJob(): JobWithSokosumiStatus {
  return {
    id: "job-1",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: null,
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    taskId: null,
    name: "Shared Job",
    jobType: "FREE",
    status: SokosumiJobStatus.PROCESSING,
    credits: 0,
    cents: BigInt(0),
    onChainStatus: null,
    onChainTransactionHash: null,
    result: null,
    resultHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    agentJobId: "agent-job-1",
    identifierFromPurchaser: null,
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

describe("JobDetailsView", () => {
  it("renders from props without session or private query hooks", () => {
    const job = createJob();

    render(<JobDetailsView job={job} readOnly showAgentHeader={false} />);

    expect(screen.getByTestId("job-details-name")).toHaveTextContent("job-1");
    expect(screen.getAllByTestId("job-meta-details")).toHaveLength(2);
    expect(screen.getByTestId("job-details-footer")).toBeInTheDocument();
    expect(useSessionMock).not.toHaveBeenCalled();
    expect(useQueryMock).not.toHaveBeenCalled();
  });
});
