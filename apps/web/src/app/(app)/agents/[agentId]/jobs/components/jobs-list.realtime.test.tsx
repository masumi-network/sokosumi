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
  refresh: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), refresh: channel.refresh }),
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

vi.mock("./jobs-search", () => ({
  JobsSearch: () => null,
  filterJobsByQuery: (jobs: JobSummary[]) => jobs,
  useJobsSearchQuery: () => ({
    searchValue: "",
    handleInputChange: vi.fn(),
    handleClear: vi.fn(),
  }),
}));

vi.mock("./jobs-list.utils", () => ({
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

function receive(jobId: string, agentId = "agent-1") {
  act(() => {
    channel.handler?.({
      name: "job_status_data",
      data: {
        jobId,
        agentId,
        jobStatus: SokosumiJobStatus.COMPLETED,
        jobStatusSettled: true,
      },
    });
  });
}

function list(jobs: JobSummary[]) {
  return (
    <JobsList
      jobs={jobs}
      jobsNextCursor={null}
      userId="user-1"
      agentId="agent-1"
      workspaceId="workspace-1"
    />
  );
}

describe("JobsList live status", () => {
  beforeEach(() => {
    channel.names = [];
    channel.handler = null;
    channel.badgeRenders = 0;
    channel.refresh.mockReset();
  });

  it("attaches the active Workspace's channel on Mainnet, also while it lists no Job", () => {
    render(list([]));

    expect(new Set(channel.names)).toEqual(
      new Set(["agent_jobs:mainnet:workspace_workspace-1:user_user-1"]),
    );
  });

  // The channel is the Workspace's: it carries Jobs of other Agents too.
  it("ignores an event of another Agent's Job and takes a listed Job's", () => {
    render(list([createJob("job-1")]));
    const rendersBefore = channel.badgeRenders;

    receive("job-of-another-agent", "agent-2");
    expect(channel.badgeRenders).toBe(rendersBefore);
    expect(channel.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent(
      SokosumiJobStatus.PROCESSING,
    );

    receive("job-1");
    expect(channel.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent(
      SokosumiJobStatus.COMPLETED,
    );
  });

  // Core read the row as processing, the Job completed, and the row arrives
  // after its event: the row shows the event's status, as before the rename.
  it.each([
    ["an empty list", []],
    ["a list of other Jobs", [createJob("job-0")]],
  ])(
    "shows a Job that arrives after its event as completed, in %s",
    (_list, held) => {
      const { rerender } = render(list(held));

      receive("job-1");
      // The list is read again, so the row comes from Core.
      expect(channel.refresh).toHaveBeenCalledTimes(1);

      rerender(list([createJob("job-1"), ...held]));
      expect(screen.getAllByTestId("status")[0]).toHaveTextContent(
        SokosumiJobStatus.COMPLETED,
      );
    },
  );

  it("shows a Job that arrives before its event as completed", () => {
    const { rerender } = render(list([]));

    rerender(list([createJob("job-1")]));
    receive("job-1");

    expect(channel.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent(
      SokosumiJobStatus.COMPLETED,
    );
  });

  it("ignores an unlisted Job's event that names no Agent, as an older Core sends it", () => {
    render(list([createJob("job-0")]));
    const rendersBefore = channel.badgeRenders;

    act(() => {
      channel.handler?.({
        name: "job_status_data",
        data: {
          jobId: "job-1",
          jobStatus: SokosumiJobStatus.COMPLETED,
          jobStatusSettled: true,
        },
      });
    });

    expect(channel.badgeRenders).toBe(rendersBefore);
    expect(channel.refresh).not.toHaveBeenCalled();
  });
});
