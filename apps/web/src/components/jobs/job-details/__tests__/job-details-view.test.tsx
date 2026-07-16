import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JobDetailsView from "@/components/jobs/job-details/job-details-view";
import type { Job } from "@/lib/clients/generated/core";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

const useSessionMock = vi.fn();
const useQueryMock = vi.fn();
const useJobsHeaderMock = vi.fn();
const moveJobDialogMock = vi.fn();

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
  default: ({ detailActions }: { detailActions?: React.ReactNode }) => (
    <div data-testid="jobs-header">{detailActions}</div>
  ),
}));

vi.mock("@/app/agents/[agentId]/jobs/components/jobs-header-context", () => ({
  useJobsHeader: (...args: unknown[]) => useJobsHeaderMock(...args),
}));

vi.mock("@/lib/helpers/agent", () => ({
  getAgentLegal: () => [],
  getAgentName: () => "Research Agent",
}));

vi.mock("@/components/jobs/job-details/job-details-name", () => ({
  default: ({ name }: { name: string }) => (
    <div data-testid="job-details-name">{name}</div>
  ),
  useJobDetailsNameController: () => ({
    editing: false,
    form: {},
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    submit: vi.fn(),
  }),
}));

vi.mock("@/components/jobs/job-details/job-share-button", () => ({
  default: ({ label }: { label?: string }) => (
    <button type="button" aria-label={label ?? "share"} />
  ),
}));

vi.mock("@/components/jobs/job-details/move-job-to-workspace-dialog", () => ({
  MoveJobToWorkspaceDialog: (props: { open?: boolean }) => {
    moveJobDialogMock(props);
    return props.open ? <div data-testid="move-job-dialog" /> : null;
  },
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => (
    <div data-testid="job-status-badge">{status}</div>
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
    name: "Shared Job",
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
  };
}

describe("JobDetailsView", () => {
  it("renders from props without session or private query hooks", () => {
    const job = createJob();
    useJobsHeaderMock.mockReturnValue(null);

    render(<JobDetailsView job={job} readOnly showAgentHeader={false} />);

    expect(screen.getByTestId("job-details-name")).toHaveTextContent(
      "Shared Job",
    );
    expect(screen.getAllByTestId("job-meta-details")).toHaveLength(2);
    expect(screen.getByTestId("job-details-footer")).toBeInTheDocument();
    expect(useSessionMock).not.toHaveBeenCalled();
    expect(useQueryMock).not.toHaveBeenCalled();
  });

  it("does not render public share chrome without publicJobLayout", () => {
    useJobsHeaderMock.mockReturnValue(null);

    render(
      <JobDetailsView job={createJob()} readOnly showAgentHeader={false} />,
    );

    expect(screen.queryByText("eyebrow")).not.toBeInTheDocument();
    expect(screen.queryByTestId("job-status-badge")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Research Agent" }),
    ).not.toBeInTheDocument();
  });

  it("renders public share chrome when publicJobLayout is set", () => {
    useJobsHeaderMock.mockReturnValue(null);

    render(
      <JobDetailsView
        job={createJob()}
        readOnly
        showAgentHeader={false}
        publicJobLayout
      />,
    );

    expect(screen.getByText("eyebrow")).toBeInTheDocument();
    expect(screen.getByTestId("job-status-badge")).toHaveTextContent(
      SokosumiJobStatus.PROCESSING,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Research Agent" }),
    ).toBeInTheDocument();
  });

  it("renders edit and share controls in the top header when agent header is shown", () => {
    useJobsHeaderMock.mockReturnValue({
      agent: {
        id: "agent-1",
        creditsPrice: { cents: BigInt(100) },
      },
      ratingStats: { averageRating: 0, ratingCount: 0 },
      canRate: false,
      existingRating: null,
      disabled: false,
    });

    render(
      <JobDetailsView job={createJob()} readOnly={false} showAgentHeader />,
    );

    expect(screen.getByLabelText("edit")).toBeInTheDocument();
    expect(screen.getByLabelText("share")).toBeInTheDocument();
  });

  it("renders a move action for standalone jobs when another workspace is available", () => {
    useJobsHeaderMock.mockReturnValue({
      agent: {
        id: "agent-1",
        creditsPrice: { cents: BigInt(100) },
      },
      ratingStats: { averageRating: 0, ratingCount: 0 },
      canRate: false,
      existingRating: null,
      disabled: false,
    });

    render(
      <JobDetailsView
        job={createJob()}
        organizations={[
          {
            organizationId: "org-1",
            organization: {
              id: "org-1",
              name: "Org One",
            },
          } as never,
        ]}
        personalWorkspaceLabel="Ada Lovelace"
        readOnly={false}
        showAgentHeader
      />,
    );

    expect(screen.getByLabelText("moveToWorkspace")).toBeInTheDocument();
    expect(moveJobDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentOrganizationId: null,
        jobId: "job-1",
        organizations: expect.any(Array),
        personalWorkspaceLabel: "Ada Lovelace",
      }),
    );
  });

  it("shows a tooltip instead of an active move control for task-linked jobs", () => {
    useJobsHeaderMock.mockReturnValue({
      agent: {
        id: "agent-1",
        creditsPrice: { cents: BigInt(100) },
      },
      ratingStats: { averageRating: 0, ratingCount: 0 },
      canRate: false,
      existingRating: null,
      disabled: false,
    });

    render(
      <JobDetailsView
        job={createJob({ taskId: "task-1" })}
        organizations={[
          {
            organizationId: "org-1",
            organization: {
              id: "org-1",
              name: "Org One",
            },
          } as never,
        ]}
        personalWorkspaceLabel="Ada Lovelace"
        readOnly={false}
        showAgentHeader
      />,
    );

    const moveButton = screen.getByLabelText("moveToWorkspace");
    expect(screen.queryByTestId("move-job-dialog")).not.toBeInTheDocument();
    expect(moveButton).toBeDisabled();
    expect(moveButton.parentElement).toHaveAttribute(
      "data-slot",
      "tooltip-trigger",
    );
  });
});
