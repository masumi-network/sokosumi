import type { JobSummary } from "@sokosumi/core-client";
import { JobType, SokosumiJobStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobsList } from "@/app/agents/[agentId]/jobs/components/jobs-list";

const channel = vi.hoisted(() => ({
  names: [] as string[],
  handler: null as ((message: { name: string; data: unknown }) => void) | null,
  badgeRenders: 0,
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => children,
  useChannel: (
    channelName: string,
    _eventName: string,
    handler: (message: { name: string; data: unknown }) => void,
  ) => {
    channel.names.push(channelName);
    channel.handler = handler;
  },
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/ably/realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: () => ({
    network: "Mainnet",
    vercelEnv: "production",
  }),
}));

// One frame per event is the hook's own subject; here an event flushes at once.
vi.mock("@/hooks/effects/use-animation-frame-batch", () => ({
  useAnimationFrameBatch:
    <T,>(onFlush: (items: T[]) => void) =>
    (item: T) =>
      onFlush([item]),
}));

vi.mock("../jobs-search", () => ({
  JobsSearch: () => null,
  filterJobsByQuery: (jobs: JobSummary[]) => jobs,
  useJobsSearchQuery: () => ({
    searchValue: "",
    handleInputChange: vi.fn(),
    handleClear: vi.fn(),
  }),
}));

vi.mock("../jobs-list.utils", () => ({
  buildJobDayGroups: (jobs: JobSummary[]) => [{ key: "day", jobs }],
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => {
    channel.badgeRenders += 1;
    return <span data-testid="status">{status}</span>;
  },
}));

function createJob(id: string): JobSummary {
  const owner = { id: "user-1", name: "User", image: null };
  return {
    id,
    creator: null,
    name: id,
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    agentId: "agent-1",
    ownerId: owner.id,
    owner,
    userId: owner.id,
    user: owner,
    organizationId: null,
    projectId: null,
    workspace: { id: "workspace-1", organizationId: null, organization: null },
    taskId: null,
    credits: 0,
    jobStatusSettled: false,
  };
}

function receive(jobId: string) {
  act(() => {
    channel.handler?.({
      name: "job_status_data",
      data: {
        jobId,
        jobStatus: SokosumiJobStatus.COMPLETED,
        jobStatusSettled: true,
      },
    });
  });
}

function renderList(jobs: JobSummary[]) {
  render(
    <JobsList
      jobs={jobs}
      jobsNextCursor={null}
      userId="user-1"
      agentId="agent-1"
    />,
  );
}

describe("JobsList live status", () => {
  beforeEach(() => {
    channel.names = [];
    channel.handler = null;
    channel.badgeRenders = 0;
  });

  it("attaches the Workspace channel of its Jobs on Mainnet", () => {
    renderList([createJob("job-1")]);

    expect(new Set(channel.names)).toEqual(
      new Set(["agent_jobs:mainnet:workspace_workspace-1:user_user-1"]),
    );
  });

  it("attaches no channel for an empty list", () => {
    renderList([]);

    expect(channel.names).toEqual([]);
  });

  // The channel is the Workspace's: it carries Jobs of other Agents too.
  it("ignores an event of a Job it does not list and takes a listed Job's", () => {
    renderList([createJob("job-1")]);
    const rendersBefore = channel.badgeRenders;

    receive("job-of-another-agent");
    expect(channel.badgeRenders).toBe(rendersBefore);
    expect(screen.getByTestId("status")).toHaveTextContent(
      SokosumiJobStatus.PROCESSING,
    );

    receive("job-1");
    expect(screen.getByTestId("status")).toHaveTextContent(
      SokosumiJobStatus.COMPLETED,
    );
  });
});
