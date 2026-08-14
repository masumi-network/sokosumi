import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TaskJobs } from "@/app/tasks/components/task-jobs";
import { JobType, SokosumiJobStatus } from "@/lib/clients/generated/core";
import type { JobSummary } from "@/lib/clients/generated/core/types.gen";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("../task-job-status-badge.client", () => ({
  TaskJobStatusBadge: ({
    initialStatus,
    jobId,
  }: {
    initialStatus: string;
    jobId: string;
  }) => <span>{`realtime:${jobId}:${initialStatus}`}</span>,
}));

vi.mock("../task-jobs-realtime-provider.client", () => ({
  TaskJobsRealtimeProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  TaskJobStatusChannelProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: ({ date }: { date: string | Date }) => (
    <span>{`ago:${date instanceof Date ? date.toISOString() : date}`}</span>
  ),
}));

function createJobSummary(overrides: Partial<JobSummary>): JobSummary {
  const owner = {
    id: "user-1",
    name: "Test User",
    image: null as string | null,
    ...("owner" in overrides && overrides.owner ? overrides.owner : {}),
  };

  return {
    id: "job-1",
    agentId: "agent-1",
    ownerId: overrides.ownerId ?? owner.id,
    owner,
    name: "Job name",
    createdAt: new Date("2026-02-09T10:00:00.000Z"),
    updatedAt: new Date("2026-02-09T10:00:00.000Z"),
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    credits: 0,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: null,
      organization: null,
    },
    userId: overrides.ownerId ?? owner.id,
    user: owner,
    organization: null,
    projectId: null,
    ...overrides,
    jobStatusSettled: overrides.jobStatusSettled ?? false,
  };
}

const baseProps = {
  title: "Jobs",
  agents: [] as CoreAgentDto[],
  userId: "user-1",
  emptyLabel: "No jobs yet.",
  untitledLabel: "Untitled job",
  unknownAgentLabel: "Unknown agent",
};

describe("TaskJobsSection", () => {
  it("renders empty state when there are no jobs", () => {
    render(<TaskJobs {...baseProps} jobs={[]} />);

    expect(screen.getByText("No jobs yet.")).toBeInTheDocument();
  });

  it("renders jobs newest first, links to agent job detail, and uses fallbacks", () => {
    const jobs: JobSummary[] = [
      createJobSummary({
        id: "job-older",
        agentId: "agent-1",
        name: "Older job",
        createdAt: new Date("2026-02-09T10:00:00.000Z"),
        updatedAt: new Date("2026-02-09T10:00:00.000Z"),
        status: SokosumiJobStatus.COMPLETED,
      }),
      createJobSummary({
        id: "job-newer",
        agentId: "agent-2",
        name: "   ",
        createdAt: new Date("2026-02-10T10:00:00.000Z"),
        updatedAt: new Date("2026-02-10T10:00:00.000Z"),
        status: SokosumiJobStatus.PROCESSING,
      }),
    ];

    render(
      <TaskJobs
        {...baseProps}
        jobs={jobs}
        agents={[
          createMockCoreAgent({
            id: "agent-1",
            name: "Known agent",
            icon: null,
          }),
        ]}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/jobs/job-newer");
    expect(links[1]).toHaveAttribute("href", "/jobs/job-older");

    expect(screen.getByText("Untitled job")).toBeInTheDocument();
    expect(screen.getByText("Unknown agent")).toBeInTheDocument();
    expect(screen.getByText("Known agent")).toBeInTheDocument();

    expect(
      screen.getByText("ago:2026-02-10T10:00:00.000Z"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ago:2026-02-09T10:00:00.000Z"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("realtime:job-newer:processing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("realtime:job-older:completed"),
    ).toBeInTheDocument();
  });
});
