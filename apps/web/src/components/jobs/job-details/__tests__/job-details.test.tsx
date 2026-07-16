import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import JobDetails from "@/components/jobs/job-details/job-details";
import type { Job } from "@/lib/clients/generated/core";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

const useSessionMock = vi.fn();
const useQueryMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const getJobQueryOptionsMock = vi.fn();
const getJobQueryKeyMock = vi.fn();
const jobDetailsViewMock = vi.fn();

let useChannelHandler:
  | ((message: { name: string; data: unknown }) => void)
  | null = null;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: (...args: unknown[]) => useSessionMock(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args),
  }),
}));

vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="channel-provider">{children}</div>
  ),
  useChannel: (
    _channelName: string,
    _eventName: string,
    handler: (message: { name: string; data: unknown }) => void,
  ) => {
    useChannelHandler = handler;
  },
}));

vi.mock("@/contexts/alby-provider.dynamic", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/queries", () => ({
  getJobQueryKey: (...args: unknown[]) => getJobQueryKeyMock(...args),
  getJobQueryOptions: (...args: unknown[]) => getJobQueryOptionsMock(...args),
}));

vi.mock("@/components/jobs/job-details/job-details-view", () => ({
  default: (props: unknown) => {
    jobDetailsViewMock(props);
    return <div data-testid="job-details-presenter" />;
  },
}));

function createJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    createdAt: new Date("2026-03-26T10:00:00.000Z"),
    updatedAt: new Date("2026-03-26T10:05:00.000Z"),
    completedAt: null,
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    organization: null,
    projectId: null,
    taskId: null,
    name: "Initial Job",
    jobType: "FREE",
    status: SokosumiJobStatus.PROCESSING,
    credits: 0,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: null,
    resultHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    agentJobId: "agent-job-1",
    identifierFromPurchaser: null,
    share: null,
    events: [],
    user: {
      id: "user-1",
      name: "Ada Lovelace",
      image: null,
    },
    workspace: {
      id: "workspace-1",
      organizationId: null,
      organization: null,
    },
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
    ...overrides,
    jobStatusSettled: overrides?.jobStatusSettled ?? false,
  };
}

describe("JobDetails", () => {
  it("privately refetches and passes the latest job into the presenter", () => {
    const session = {
      user: { id: "user-1" },
    };
    const initialJob = createJob();
    const refreshedJob = createJob({ name: "Refetched Job" });

    useSessionMock.mockReturnValue({ data: session });
    getJobQueryOptionsMock.mockReturnValue({ staleTime: 1000 });
    useQueryMock.mockReturnValue({ data: refreshedJob });

    render(
      <JobDetails
        job={initialJob}
        readOnly
        className="w-full"
        showAgentHeader={false}
      />,
    );

    expect(getJobQueryOptionsMock).toHaveBeenCalledWith("job-1", session);
    expect(useQueryMock).toHaveBeenCalledWith({
      staleTime: 1000,
      enabled: true,
      initialData: initialJob,
    });
    expect(jobDetailsViewMock).toHaveBeenCalledWith({
      job: refreshedJob,
      organizations: undefined,
      personalWorkspaceLabel: undefined,
      readOnly: true,
      className: "w-full",
      showAgentHeader: false,
      publicJobLayout: false,
    });
    expect(screen.getByTestId("channel-provider")).toBeInTheDocument();
  });

  it("invalidates the private job query when a matching realtime update arrives", () => {
    const session = {
      user: { id: "user-1" },
    };
    const initialJob = createJob();

    useSessionMock.mockReturnValue({ data: session });
    getJobQueryOptionsMock.mockReturnValue({});
    getJobQueryKeyMock.mockReturnValue(["jobs", "job-1"]);
    useQueryMock.mockReturnValue({ data: initialJob });

    render(<JobDetails job={initialJob} />);

    act(() => {
      useChannelHandler?.({
        name: "job_status_data",
        data: {
          jobId: "job-1",
          jobStatus: "completed",
          jobStatusSettled: true,
        },
      });
    });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["jobs", "job-1"],
    });
  });
});
