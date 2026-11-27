import { SokosumiJobStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { TaskJobStatusBadge } from "./task-job-status-badge.client";

const channel = vi.hoisted(() => ({
  handler: null as ((message: { data: unknown }) => void) | null,
}));

vi.mock("ably/react", () => ({
  useChannel: (
    _channelName: string,
    handler: (message: { data: unknown }) => void,
  ) => {
    channel.handler = handler;
  },
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

function receive(jobId: string) {
  act(() => {
    channel.handler?.({
      data: {
        jobId,
        jobStatus: SokosumiJobStatus.COMPLETED,
        jobStatusSettled: true,
      },
    });
  });
}

describe("TaskJobStatusBadge", () => {
  // The channel is the Workspace's: it carries the user's other Jobs too.
  it("keeps its status on another Job's event and takes its own Job's", () => {
    render(
      <TaskJobStatusBadge
        channelName="channel"
        jobId="job-1"
        initialStatus={SokosumiJobStatus.PROCESSING}
      />,
    );

    receive("job-2");
    expect(screen.getByText(SokosumiJobStatus.PROCESSING)).toBeInTheDocument();

    receive("job-1");
    expect(screen.getByText(SokosumiJobStatus.COMPLETED)).toBeInTheDocument();
  });
});
